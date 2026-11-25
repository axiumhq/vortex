use std::collections::HashMap;

use revolt_database::{
    util::{permissions::DatabasePermissionQuery, reference::Reference},
    voice::{sync_voice_permissions, VoiceClient},
    AuditLogEntryAction, Database, PartialServer, User,
};
use revolt_models::v0;
use revolt_permissions::{calculate_server_permissions, ChannelPermission, OverrideField};
use revolt_result::{create_error, Result};
use rocket::{serde::json::Json, State};

use crate::util::{
    audit_log_reason::AuditLogReason,
    overrides::{
        apply_overrides, check_override_changes, has_overrides, normalize, propagate_to_threads,
    },
};

/// # Set Category Permissions
///
/// Replaces the permission overrides of a category.
///
/// Vortex: categories do not take part in permission calculation. They hold
/// a set of overrides that channels copy; channels whose overrides were equal
/// to the category's before this change (synced channels) receive the new
/// set, and channels that diverged are left alone.
#[openapi(tag = "Server Permissions")]
#[put("/<target>/categories/<category_id>/permissions", data = "<data>")]
pub async fn set_category_permissions(
    db: &State<Database>,
    voice_client: &State<VoiceClient>,
    user: User,
    reason: AuditLogReason,
    target: Reference<'_>,
    category_id: String,
    data: Json<v0::DataSetCategoryPermissions>,
) -> Result<Json<v0::Server>> {
    let data = data.into_inner();
    let mut server = target.as_server(db).await?;

    let mut categories = server.categories.clone().unwrap_or_default();
    let Some(index) = categories.iter().position(|c| c.id == category_id) else {
        return Err(create_error!(NotFound));
    };

    let (after_default, after_roles) = normalize(
        data.default_permissions.map(OverrideField::from),
        &data
            .role_permissions
            .into_iter()
            .map(|(role, value)| (role, OverrideField::from(value)))
            .collect::<HashMap<String, OverrideField>>(),
    );

    let before_default = categories[index].default_permissions;
    let before_roles = categories[index].role_permissions.clone();

    {
        let mut query = DatabasePermissionQuery::new(db, &user).server(&server);
        let permissions = calculate_server_permissions(&mut query).await;
        permissions.throw_if_lacking_channel_permission(ChannelPermission::ManagePermissions)?;

        let our_ranking = query.get_member_rank().unwrap_or(i64::MIN);

        check_override_changes(
            &permissions,
            &server,
            &user.id,
            our_ranking,
            before_default,
            &before_roles,
            after_default,
            &after_roles,
        )
        .await?;
    }

    if before_default == after_default && before_roles == after_roles {
        return Ok(Json(server.into(db).await));
    }

    categories[index].default_permissions = after_default;
    categories[index].role_permissions = after_roles.clone();
    let synced_candidates = categories[index].channels.clone();

    let partial = PartialServer {
        categories: Some(categories),
        ..Default::default()
    };

    let before = server.generate_diff(&partial, &[]);
    server.update(db, partial.clone(), vec![]).await?;

    AuditLogEntryAction::ServerEdit {
        before,
        after: partial,
    }
    .insert(db, server.id.clone(), reason, user.id.clone(), None)
    .await;

    // Arrasta os canais que estavam sincronizados. Um canal que falha não
    // desfaz a categoria: ela já foi gravada, e o canal segue com o conjunto
    // antigo, que é exatamente o estado "dessincronizado" que a tela mostra.
    for mut channel in db.fetch_channels(&synced_candidates).await? {
        if !has_overrides(&channel, before_default, &before_roles) {
            continue;
        }

        if apply_overrides(db, &mut channel, after_default, &after_roles)
            .await
            .is_ok()
        {
            propagate_to_threads(db, &channel).await.ok();
            sync_voice_permissions(db, voice_client, &channel, Some(&server), None)
                .await
                .ok();
        }
    }

    Ok(Json(server.into(db).await))
}
