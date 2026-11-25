use revolt_database::{
    util::{permissions::DatabasePermissionQuery, reference::Reference},
    Channel, Database, PartialChannel, User,
};
use revolt_permissions::{calculate_channel_permissions, ChannelPermission};
use revolt_result::{create_error, Result};
use rocket::State;
use rocket_empty::EmptyResponse;

/// Adds or removes the user from the followers of a thread.
async fn set_following(
    db: &Database,
    user: &User,
    target: Reference<'_>,
    follow: bool,
) -> Result<EmptyResponse> {
    let mut channel: Channel = target.as_channel(db).await?;
    // The derived state, so following an idle thread does not publish it as
    // active — see `Channel::thread_archived`.
    let Some(mut info) = channel.thread_now(&revolt_database::thread_archive_cutoff_now()) else {
        return Err(create_error!(InvalidOperation));
    };

    let mut query = DatabasePermissionQuery::new(db, user).channel(&channel);
    calculate_channel_permissions(&mut query)
        .await
        .throw_if_lacking_channel_permission(ChannelPermission::ViewChannel)?;

    let following = info.followers.iter().any(|id| id == &user.id);
    if following == follow {
        return Err(create_error!(NoEffect));
    }

    if follow {
        info.followers.push(user.id.clone());
    } else {
        info.followers.retain(|id| id != &user.id);
    }

    channel
        .update(
            db,
            PartialChannel {
                thread: Some(info),
                ..Default::default()
            },
            vec![],
        )
        .await?;

    Ok(EmptyResponse)
}

/// # Follow Thread
///
/// Vortex: follow a thread.
#[openapi(tag = "Channel Information")]
#[put("/<target>/follow")]
pub async fn follow_thread(
    db: &State<Database>,
    user: User,
    target: Reference<'_>,
) -> Result<EmptyResponse> {
    set_following(db, &user, target, true).await
}

/// # Unfollow Thread
///
/// Vortex: stop following a thread.
#[openapi(tag = "Channel Information")]
#[delete("/<target>/follow")]
pub async fn unfollow_thread(
    db: &State<Database>,
    user: User,
    target: Reference<'_>,
) -> Result<EmptyResponse> {
    set_following(db, &user, target, false).await
}

#[cfg(test)]
mod test {
    use crate::util::test::TestHarness;
    use revolt_database::{Channel, Member};
    use revolt_models::v0;
    use rocket::http::{Header, Status};

    async fn seguir(harness: &TestHarness, token: &str, canal: &str, seguir: bool) -> Status {
        let caminho = format!("/channels/{canal}/follow");
        let request = if seguir {
            harness.client.put(caminho)
        } else {
            harness.client.delete(caminho)
        };
        request
            .header(Header::new("x-session-token", token.to_string()))
            .dispatch()
            .await
            .status()
    }

    async fn seguidores(harness: &TestHarness, id: &str) -> Vec<String> {
        harness
            .db
            .fetch_channel(id)
            .await
            .unwrap()
            .thread()
            .unwrap()
            .followers
            .clone()
    }

    #[rocket::async_test]
    async fn seguir_e_deixar_de_seguir() {
        let harness = TestHarness::new().await;
        let (_, _, owner) = harness.new_user().await;
        let (_, session, member) = harness.new_user().await;
        let (server, channels) = harness.new_server(&owner).await;
        Member::create(&harness.db, &server, &member, None)
            .await
            .expect("`Member`");

        let topico = Channel::create_thread(
            &harness.db,
            &channels[0],
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
            seguir(&harness, &session.token, topico.id(), true).await,
            Status::NoContent
        );
        assert!(seguidores(&harness, topico.id()).await.contains(&member.id));

        // Seguir de novo não muda nada, e o servidor diz isso.
        assert_eq!(
            seguir(&harness, &session.token, topico.id(), true).await,
            Status::BadRequest
        );

        assert_eq!(
            seguir(&harness, &session.token, topico.id(), false).await,
            Status::NoContent
        );
        let depois = seguidores(&harness, topico.id()).await;
        assert!(!depois.contains(&member.id));
        assert!(depois.contains(&owner.id), "o dono segue seguindo");

        assert_eq!(
            seguir(&harness, &session.token, topico.id(), false).await,
            Status::BadRequest
        );
    }

    /// Só tópico tem seguidores.
    #[rocket::async_test]
    async fn recusa_canal_que_nao_e_topico() {
        let harness = TestHarness::new().await;
        let (_, session, owner) = harness.new_user().await;
        let (_, channels) = harness.new_server(&owner).await;

        assert_eq!(
            seguir(&harness, &session.token, channels[0].id(), true).await,
            Status::BadRequest
        );
    }
}
