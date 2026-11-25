use revolt_database::{
    util::{permissions::DatabasePermissionQuery, reference::Reference},
    voice::{sync_voice_permissions, VoiceClient},
    AuditLogEntryAction, Database, User,
};
use revolt_models::v0;
use revolt_permissions::{ChannelPermission, Override, OverrideField, PermissionQuery, calculate_channel_permissions};
use revolt_result::{create_error, Result};
use rocket::{serde::json::Json, State};

use crate::util::{audit_log_reason::AuditLogReason, overrides::propagate_to_threads};

/// # Set Role Permission
///
/// Sets permissions for the specified role in this channel.
///
/// Channel must be a `TextChannel`.
#[openapi(tag = "Channel Permissions")]
#[put("/<target>/permissions/<role_id>", data = "<data>", rank = 2)]
pub async fn set_role_permissions(
    db: &State<Database>,
    voice_client: &State<VoiceClient>,
    user: User,
    reason: AuditLogReason,
    target: Reference<'_>,
    role_id: String,
    data: Json<v0::DataSetRolePermissions>,
) -> Result<Json<v0::Channel>> {
    let channel = target.as_channel(db).await?;
    let mut query = DatabasePermissionQuery::new(db, &user).channel(&channel);
    let permissions: revolt_permissions::PermissionValue =
        calculate_channel_permissions(&mut query).await;

    query.set_server_from_channel().await;

    permissions.throw_if_lacking_channel_permission(ChannelPermission::ManagePermissions)?;

    if let Some(server) = query.server_ref() {
        if let Some(role) = server.roles.get(&role_id) {
            if server.owner != user.id
                && role.rank <= query.get_member_rank().unwrap_or(i64::MIN)
            {
                return Err(create_error!(NotElevated));
            }

            let current_value: Override = role.permissions.into();
            permissions
                .throw_permission_override(current_value, &data.permissions)
                .await?;

            let mut new_channel = channel.clone();
            let override_field: OverrideField = data.permissions.clone().into();
            let server_id = server.id.clone();

            new_channel
                .set_role_permission(db, &role_id, data.permissions.clone().into())
                .await?;

            propagate_to_threads(db, &new_channel).await?;

            sync_voice_permissions(db, voice_client, &new_channel, Some(server), Some(&role_id))
                .await?;

            AuditLogEntryAction::ChannelRolePermissionsEdit {
                channel: new_channel.id().to_string(),
                role: role_id,
                permissions: override_field,
            }
            .insert(db, server_id, reason, user.id, None)
            .await;

            Ok(Json(new_channel.into()))
        } else {
            Err(create_error!(NotFound))
        }
    } else {
        Err(create_error!(InvalidOperation))
    }
}

#[cfg(test)]
mod test {
    use crate::util::test::TestHarness;
    use revolt_database::{events::client::EventV1, Channel, Member, PartialChannel, PartialMember};
    use revolt_models::v0;
    use revolt_permissions::{ChannelPermission, OverrideField};
    use rocket::http::{ContentType, Header, Status};

    /// Negar o cargo no pai nega também no tópico: a sobreposição de cargo é
    /// copiada como a padrão.
    #[rocket::async_test]
    async fn cargo_negado_no_pai_some_do_topico() {
        let mut harness = TestHarness::new().await;
        let (_, owner_session, owner) = harness.new_user().await;
        let (_, member_session, member) = harness.new_user().await;
        let (server, mut channels) = harness.new_server(&owner).await;
        let (membro, _) = Member::create(&harness.db, &server, &member, None)
            .await
            .expect("`Member`");

        // Privado por padrão, aberto para um cargo: o membro vê pelo cargo.
        let cargo = harness.new_role(&server, 1, None).await;
        harness
            .db
            .update_member(
                &membro.id,
                &PartialMember {
                    roles: Some(vec![cargo.id.clone()]),
                    ..Default::default()
                },
                vec![],
            )
            .await
            .expect("cargo no membro");

        let pai = &mut channels[0];
        pai.update(
            &harness.db,
            PartialChannel {
                default_permissions: Some(OverrideField {
                    a: 0,
                    d: ChannelPermission::ViewChannel as i64,
                }),
                role_permissions: Some(
                    [(
                        cargo.id.clone(),
                        OverrideField {
                            a: ChannelPermission::ViewChannel as i64,
                            d: 0,
                        },
                    )]
                    .into(),
                ),
                ..Default::default()
            },
            vec![],
        )
        .await
        .unwrap();

        let topico = Channel::create_thread(
            &harness.db,
            pai,
            &owner.id,
            v0::DataCreateThread {
                name: "Tópico".to_string(),
                message: None,
                tags: vec![],
            },
        )
        .await
        .expect("`Channel`");
        assert_eq!(
            harness.list_threads(&member_session, &server.id, false).await,
            vec![topico.id().to_string()]
        );

        let response = harness
            .client
            .put(format!("/channels/{}/permissions/{}", pai.id(), cargo.id))
            .header(Header::new("x-session-token", owner_session.token.to_string()))
            .header(ContentType::JSON)
            .body(
                json!({
                    "permissions": {
                        "allow": 0,
                        "deny": ChannelPermission::ViewChannel as u64
                    }
                })
                .to_string(),
            )
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::Ok);
        drop(response);

        assert!(harness
            .list_threads(&member_session, &server.id, false)
            .await
            .is_empty());

        let id = topico.id().to_string();
        harness
            .wait_for_event(&server.id, |event| {
                matches!(
                    event,
                    EventV1::ChannelUpdate { id: alvo, data, .. }
                        if alvo == &id && data.role_permissions.is_some()
                )
            })
            .await;
    }
}
