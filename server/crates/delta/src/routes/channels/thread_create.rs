use revolt_database::{
    util::{permissions::DatabasePermissionQuery, reference::Reference},
    Channel, Database, User,
};
use revolt_models::v0;
use revolt_permissions::{calculate_channel_permissions, ChannelPermission};
use revolt_result::{create_error, Result};
use rocket::{serde::json::Json, State};
use validator::Validate;

/// # Create Thread
///
/// Vortex: starts a thread inside a server text channel, optionally from one of
/// its messages. In a forum or media channel the thread is a post, and its
/// first message is the post body.
#[openapi(tag = "Channel Information")]
#[post("/<target>/threads", data = "<data>")]
pub async fn create_thread(
    db: &State<Database>,
    user: User,
    target: Reference<'_>,
    data: Json<v0::DataCreateThread>,
) -> Result<Json<v0::Channel>> {
    let data = data.into_inner();
    data.validate().map_err(|error| {
        create_error!(FailedValidation {
            error: error.to_string()
        })
    })?;

    let parent = target.as_channel(db).await?;

    // Only a server text channel can hold threads, and a thread cannot hold
    // another one.
    if !matches!(parent, Channel::TextChannel { .. }) || parent.thread().is_some() {
        return Err(create_error!(InvalidOperation));
    }

    let mut query = DatabasePermissionQuery::new(db, &user).channel(&parent);
    let permissions = calculate_channel_permissions(&mut query).await;
    permissions.throw_if_lacking_channel_permission(ChannelPermission::ViewChannel)?;
    permissions.throw_if_lacking_channel_permission(ChannelPermission::SendMessage)?;

    // Tags must exist in the parent's forum.
    if !data.tags.is_empty() {
        let Some(forum) = parent.forum() else {
            return Err(create_error!(InvalidOperation));
        };

        if data
            .tags
            .iter()
            .any(|tag| !forum.tags.iter().any(|known| &known.id == tag))
        {
            return Err(create_error!(InvalidOperation));
        }
    }

    if let Some(message_id) = &data.message {
        // A post has no message of origin: it starts with its own.
        if parent.forum().is_some() {
            return Err(create_error!(InvalidOperation));
        }

        let message = Reference::from_unchecked(message_id)
            .as_message_in_channel(db, parent.id())
            .await?;

        // One thread per message: asking again answers with the existing one.
        let server = parent.server().unwrap_or_default().to_string();
        if let Some(existing) = db
            .fetch_threads(&[server], Some(parent.id()), None)
            .await?
            .into_iter()
            .find(|thread| {
                thread
                    .thread()
                    .and_then(|info| info.message.as_deref())
                    == Some(message.id.as_str())
            })
        {
            return Ok(Json(existing.into()));
        }
    }

    let thread = Channel::create_thread(db, &parent, &user.id, data).await?;
    Ok(Json(thread.into()))
}

#[cfg(test)]
mod test {
    use crate::util::test::TestHarness;
    use revolt_database::{events::client::EventV1, Channel, Member, PartialChannel};
    use revolt_models::v0;
    use revolt_permissions::{ChannelPermission, OverrideField};
    use rocket::http::{ContentType, Header, Status};
    use ulid::Ulid;

    async fn criar(
        harness: &TestHarness,
        token: &str,
        canal: &str,
        corpo: serde_json::Value,
    ) -> (Status, String) {
        let response = harness
            .client
            .post(format!("/channels/{canal}/threads"))
            .header(Header::new("x-session-token", token.to_string()))
            .header(ContentType::JSON)
            .body(corpo.to_string())
            .dispatch()
            .await;
        let status = response.status();
        (status, response.into_string().await.unwrap_or_default())
    }

    /// Pedir um tópico a partir da mesma mensagem duas vezes devolve o mesmo
    /// tópico, e a criação é anunciada com `ChannelCreate`.
    #[rocket::async_test]
    async fn idempotente_por_mensagem_e_anuncia_o_canal() {
        let mut harness = TestHarness::new().await;
        let (_, session, user) = harness.new_user().await;
        let (server, channels) = harness.new_server(&user).await;
        let (channel, _, message) = harness.new_message(&user, &server, channels).await;

        let corpo = json!({ "name": "Conversa", "message": message.id });
        let (status, primeiro) =
            criar(&harness, &session.token, channel.id(), corpo.clone()).await;
        assert_eq!(status, Status::Ok, "{primeiro}");
        let primeiro: v0::Channel = serde_json::from_str(&primeiro).unwrap();

        let id = match &primeiro {
            v0::Channel::TextChannel {
                id,
                thread: Some(info),
                ..
            } => {
                assert_eq!(info.parent, channel.id());
                assert_eq!(info.message.as_deref(), Some(message.id.as_str()));
                assert_eq!(info.followers, vec![user.id.clone()]);
                id.clone()
            }
            _ => panic!("não é um tópico"),
        };

        harness
            .wait_for_event(&server.id, |event| {
                matches!(event, EventV1::ChannelCreate(criado) if criado.id() == id)
            })
            .await;

        let (status, segundo) = criar(&harness, &session.token, channel.id(), corpo).await;
        assert_eq!(status, Status::Ok, "{segundo}");
        let segundo: v0::Channel = serde_json::from_str(&segundo).unwrap();
        assert_eq!(segundo.id(), id);

        let topicos = harness
            .db
            .fetch_threads(std::slice::from_ref(&server.id), Some(channel.id()), None)
            .await
            .unwrap();
        assert_eq!(topicos.len(), 1);
    }

    #[rocket::async_test]
    async fn recusa_em_dm() {
        let harness = TestHarness::new().await;
        let (_, session, user) = harness.new_user().await;
        let (_, _, outro) = harness.new_user().await;
        let dm = Channel::DirectMessage {
            id: Ulid::new().to_string(),
            active: true,
            recipients: vec![user.id.clone(), outro.id.clone()],
            last_message_id: None,
        };
        harness.db.insert_channel(&dm).await.unwrap();

        let (status, corpo) =
            criar(&harness, &session.token, dm.id(), json!({ "name": "Tópico" })).await;
        assert_eq!(status, Status::BadRequest, "{corpo}");
    }

    #[rocket::async_test]
    async fn recusa_topico_dentro_de_topico() {
        let harness = TestHarness::new().await;
        let (_, session, user) = harness.new_user().await;
        let (_, channels) = harness.new_server(&user).await;

        let (status, corpo) = criar(
            &harness,
            &session.token,
            channels[0].id(),
            json!({ "name": "Tópico" }),
        )
        .await;
        assert_eq!(status, Status::Ok, "{corpo}");
        let topico: v0::Channel = serde_json::from_str(&corpo).unwrap();

        let (status, corpo) =
            criar(&harness, &session.token, topico.id(), json!({ "name": "Dentro" })).await;
        assert_eq!(status, Status::BadRequest, "{corpo}");
    }

    /// No fórum o post começa com a própria mensagem: não há mensagem de origem.
    #[rocket::async_test]
    async fn recusa_mensagem_de_origem_em_forum() {
        let harness = TestHarness::new().await;
        let (_, session, user) = harness.new_user().await;
        let (server, _) = harness.new_server(&user).await;
        let forum = Channel::create_server_channel(
            &harness.db,
            &mut server.clone(),
            v0::DataCreateServerChannel {
                channel_type: v0::LegacyServerChannelType::Forum,
                name: "ideias".to_string(),
                ..Default::default()
            },
            true,
        )
        .await
        .expect("`Channel`");

        let (status, corpo) = criar(
            &harness,
            &session.token,
            forum.id(),
            json!({ "name": "Post", "message": Ulid::new().to_string() }),
        )
        .await;
        assert_eq!(status, Status::BadRequest, "{corpo}");

        let (status, corpo) =
            criar(&harness, &session.token, forum.id(), json!({ "name": "Post" })).await;
        assert_eq!(status, Status::Ok, "{corpo}");
    }

    #[rocket::async_test]
    async fn exige_enviar_mensagem_no_pai() {
        let harness = TestHarness::new().await;
        let (_, _, owner) = harness.new_user().await;
        let (_, session, member) = harness.new_user().await;
        let (server, mut channels) = harness.new_server(&owner).await;
        Member::create(&harness.db, &server, &member, None)
            .await
            .expect("`Member`");

        let canal = &mut channels[0];
        canal
            .update(
                &harness.db,
                PartialChannel {
                    default_permissions: Some(OverrideField {
                        a: 0,
                        d: ChannelPermission::SendMessage as i64,
                    }),
                    ..Default::default()
                },
                vec![],
            )
            .await
            .unwrap();

        let (status, corpo) =
            criar(&harness, &session.token, canal.id(), json!({ "name": "Tópico" })).await;
        assert_eq!(status, Status::Forbidden, "{corpo}");
    }
}
