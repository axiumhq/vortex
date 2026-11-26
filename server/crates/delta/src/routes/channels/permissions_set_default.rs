use revolt_database::{
    util::{permissions::DatabasePermissionQuery, reference::Reference},
    voice::{sync_voice_permissions, VoiceClient},
    AuditLogEntryAction, Channel, Database, PartialChannel, User,
};
use revolt_models::v0::{self, DataDefaultChannelPermissions};
use revolt_permissions::{calculate_channel_permissions, ChannelPermission};
use revolt_result::{create_error, Result};
use rocket::{serde::json::Json, State};

use crate::util::{audit_log_reason::AuditLogReason, overrides::propagate_to_threads};

/// # Set Default Permission
///
/// Sets permissions for the default role in this channel.
///
/// Channel must be a `Group` or `TextChannel`.
#[openapi(tag = "Channel Permissions")]
#[put("/<target>/permissions/default", data = "<data>", rank = 1)]
pub async fn set_default_channel_permissions(
    db: &State<Database>,
    voice_client: &State<VoiceClient>,
    user: User,
    reason: AuditLogReason,
    target: Reference<'_>,
    data: Json<v0::DataDefaultChannelPermissions>,
) -> Result<Json<v0::Channel>> {
    let data = data.into_inner();

    let mut channel = target.as_channel(db).await?;
    let mut query = DatabasePermissionQuery::new(db, &user).channel(&channel);
    let permissions = calculate_channel_permissions(&mut query).await;

    permissions.throw_if_lacking_channel_permission(ChannelPermission::ManagePermissions)?;

    match &channel {
        Channel::Group { .. } => {
            if let DataDefaultChannelPermissions::Value { permissions } = data {
                channel
                    .update(
                        db,
                        PartialChannel {
                            permissions: Some(permissions as i64),
                            ..Default::default()
                        },
                        vec![],
                    )
                    .await?;
            } else {
                return Err(create_error!(InvalidOperation));
            }
        }
        Channel::TextChannel {
            id,
            server,
            default_permissions,
            ..
        } => {
            if let DataDefaultChannelPermissions::Field { permissions: field } = data {
                permissions
                    .throw_permission_override(default_permissions.map(|x| x.into()), &field)
                    .await?;

                let partial = PartialChannel {
                    default_permissions: Some(field.into()),
                    ..Default::default()
                };

                let id = id.clone();
                let server = server.clone();

                let before = channel.generate_diff(&partial, &[]);

                channel.update(db, partial.clone(), vec![]).await?;

                AuditLogEntryAction::ChannelEdit {
                    channel: id,
                    before,
                    after: partial,
                }
                .insert(db, server, reason, user.id, None)
                .await;
            } else {
                return Err(create_error!(InvalidOperation));
            }
        }
        _ => return Err(create_error!(InvalidOperation)),
    }

    propagate_to_threads(db, &channel).await?;

    let server = match channel.server() {
        Some(server_id) => Some(Reference::from_unchecked(server_id).as_server(db).await?),
        None => None,
    };

    sync_voice_permissions(db, voice_client, &channel, server.as_ref(), None).await?;

    Ok(Json(channel.into()))
}

#[cfg(test)]
mod test {
    use crate::util::test::TestHarness;
    use revolt_database::{events::client::EventV1, Channel, Member};
    use revolt_models::v0;
    use revolt_permissions::ChannelPermission;
    use rocket::http::{ContentType, Header, Status};

    /// Segurança: o canal que vira privado leva os tópicos junto. Sem a cópia,
    /// o tópico guardaria as sobreposições da criação e continuaria aberto
    /// para quem perdeu o acesso ao pai.
    #[rocket::async_test]
    async fn canal_privado_fecha_os_topicos() {
        let mut harness = TestHarness::new().await;
        let (_, owner_session, owner) = harness.new_user().await;
        let (_, member_session, member) = harness.new_user().await;
        let (server, channels) = harness.new_server(&owner).await;
        Member::create(&harness.db, &server, &member, None)
            .await
            .expect("`Member`");

        let pai = &channels[0];
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
            .put(format!("/channels/{}/permissions/default", pai.id()))
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

        // A cópia acontece antes da resposta: sem ela, o membro ainda vê.
        let id = topico.id().to_string();
        assert!(harness
            .list_threads(&member_session, &server.id, false)
            .await
            .is_empty());
        assert_eq!(
            harness.list_threads(&owner_session, &server.id, false).await,
            vec![id.clone()]
        );

        let response = harness
            .client
            .get(format!("/channels/{id}/messages"))
            .header(Header::new("x-session-token", member_session.token.to_string()))
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::Forbidden);
        drop(response);

        let response = harness
            .client
            .post(format!("/channels/{id}/messages"))
            .header(Header::new("x-session-token", member_session.token.to_string()))
            .header(ContentType::JSON)
            .body(json!({ "content": "ainda entro?" }).to_string())
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::Forbidden);
        drop(response);

        // Os clientes abertos ficam sabendo pelo `ChannelUpdate` do tópico.
        harness
            .wait_for_event(&server.id, |event| {
                matches!(
                    event,
                    EventV1::ChannelUpdate { id: alvo, data, .. }
                        if alvo == &id && data.default_permissions.is_some()
                )
            })
            .await;
    }
}
