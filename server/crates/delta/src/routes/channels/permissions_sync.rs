use revolt_database::{
    util::{permissions::DatabasePermissionQuery, reference::Reference},
    voice::{sync_voice_permissions, VoiceClient},
    AuditLogEntryAction, Channel, Database, User,
};
use revolt_models::v0;
use revolt_permissions::{calculate_channel_permissions, ChannelPermission, PermissionQuery};
use revolt_result::{create_error, Result};
use rocket::{serde::json::Json, State};

use crate::util::{
    audit_log_reason::AuditLogReason,
    overrides::{apply_overrides, check_override_changes, propagate_to_threads},
};

/// # Sync Permissions with Category
///
/// Replaces this channel's permission overrides with those of the category
/// it belongs to.
///
/// Channel must be a `TextChannel` inside a category.
#[openapi(tag = "Channel Permissions")]
#[put("/<target>/permissions/sync", rank = 1)]
pub async fn sync_channel_permissions(
    db: &State<Database>,
    voice_client: &State<VoiceClient>,
    user: User,
    reason: AuditLogReason,
    target: Reference<'_>,
) -> Result<Json<v0::Channel>> {
    let mut channel = target.as_channel(db).await?;

    let (before_default, before_roles) = match &channel {
        Channel::TextChannel {
            default_permissions,
            role_permissions,
            ..
        } => (*default_permissions, role_permissions.clone()),
        _ => return Err(create_error!(InvalidOperation)),
    };

    let (server, category) = {
        let mut query = DatabasePermissionQuery::new(db, &user).channel(&channel);
        let permissions = calculate_channel_permissions(&mut query).await;
        permissions.throw_if_lacking_channel_permission(ChannelPermission::ManagePermissions)?;

        query.set_server_from_channel().await;
        let our_ranking = query.get_member_rank().unwrap_or(i64::MIN);

        let Some(server) = query.server_ref().as_ref().map(|s| s.clone().into_owned()) else {
            return Err(create_error!(InvalidOperation));
        };

        let Some(category) = server
            .categories
            .as_ref()
            .and_then(|categories| {
                categories
                    .iter()
                    .find(|category| category.channels.iter().any(|id| id == channel.id()))
            })
            .cloned()
        else {
            return Err(create_error!(NotFound));
        };

        check_override_changes(
            &permissions,
            &server,
            &user.id,
            our_ranking,
            before_default,
            &before_roles,
            category.default_permissions,
            &category.role_permissions,
        )
        .await?;

        (server, category)
    };

    let (before, after) = apply_overrides(
        db,
        &mut channel,
        category.default_permissions,
        &category.role_permissions,
    )
    .await?;

    propagate_to_threads(db, &channel).await?;

    AuditLogEntryAction::ChannelEdit {
        channel: channel.id().to_string(),
        before,
        after,
    }
    .insert(db, server.id.clone(), reason, user.id, None)
    .await;

    sync_voice_permissions(db, voice_client, &channel, Some(&server), None).await?;

    Ok(Json(channel.into()))
}
