use std::collections::HashSet;

use revolt_database::{
    util::{permissions::DatabasePermissionQuery, reference::Reference},
    Database, User,
};
use revolt_models::v0;
use revolt_permissions::{calculate_channel_permissions, ChannelPermission};
use revolt_result::Result;
use rocket::{serde::json::Json, State};

/// # Fetch Threads
///
/// Vortex: threads of a server that the user can see, with their opening
/// messages and message counts. Active by default; `archived=true` lists the
/// archived ones, and `channel` narrows to one channel (a forum, for example).
#[openapi(tag = "Server Information")]
#[get("/<target>/threads?<options..>")]
pub async fn fetch_threads(
    db: &State<Database>,
    user: User,
    target: Reference<'_>,
    options: v0::OptionsFetchThreads,
) -> Result<Json<v0::ThreadListResponse>> {
    let server = target.as_server(db).await?;

    let threads = db
        .fetch_threads(
            std::slice::from_ref(&server.id),
            options.channel.as_deref(),
            Some(options.archived.unwrap_or(false)),
        )
        .await?;

    let mut visible = vec![];
    for thread in threads {
        let can_view = {
            let mut query = DatabasePermissionQuery::new(db, &user)
                .channel(&thread)
                .server(&server);
            calculate_channel_permissions(&mut query)
                .await
                .has_channel_permission(ChannelPermission::ViewChannel)
        };

        if can_view {
            visible.push(thread);
        }
    }

    let ids: Vec<String> = visible.iter().map(|thread| thread.id().to_string()).collect();
    let message_counts = if ids.is_empty() {
        Default::default()
    } else {
        db.count_messages_in_channels(&ids).await?
    };

    let opening_ids: Vec<String> = visible
        .iter()
        .filter_map(|thread| thread.thread().and_then(|info| info.message.clone()))
        .collect();

    // A deleted opening message must not take the whole list down with it.
    let messages = if opening_ids.is_empty() {
        vec![]
    } else {
        db.fetch_messages_by_id(&opening_ids)
            .await
            .unwrap_or_default()
    };

    let author_ids: Vec<String> = messages
        .iter()
        .map(|message| message.author.clone())
        .collect::<HashSet<String>>()
        .into_iter()
        .collect();

    let users = if author_ids.is_empty() {
        vec![]
    } else {
        User::fetch_many_ids_as_mutuals(db, &user, &author_ids)
            .await
            .unwrap_or_default()
    };

    Ok(Json(v0::ThreadListResponse {
        threads: visible.into_iter().map(Into::into).collect(),
        messages: messages
            .into_iter()
            .map(|message| message.into_model(None, None))
            .collect(),
        users,
        message_counts,
    }))
}

#[cfg(test)]
mod test {
    use crate::util::test::TestHarness;
    use revolt_database::{Channel, Member, PartialChannel};
    use revolt_models::v0;
    use revolt_permissions::{ChannelPermission, OverrideField};

    async fn topico(harness: &TestHarness, pai: &Channel, dono: &str, nome: &str) -> Channel {
        Channel::create_thread(
            &harness.db,
            pai,
            dono,
            v0::DataCreateThread {
                name: nome.to_string(),
                message: None,
                tags: vec![],
            },
        )
        .await
        .expect("`Channel`")
    }

    /// Tópico de canal que a pessoa não vê não aparece na listagem dela.
    #[rocket::async_test]
    async fn filtra_por_permissao_de_ver() {
        let harness = TestHarness::new().await;
        let (_, owner_session, owner) = harness.new_user().await;
        let (_, member_session, member) = harness.new_user().await;
        let (server, channels) = harness.new_server(&owner).await;
        Member::create(&harness.db, &server, &member, None)
            .await
            .expect("`Member`");

        let mut privado = harness.new_channel(&server).await;
        privado
            .update(
                &harness.db,
                PartialChannel {
                    default_permissions: Some(OverrideField {
                        a: 0,
                        d: ChannelPermission::ViewChannel as i64,
                    }),
                    ..Default::default()
                },
                vec![],
            )
            .await
            .unwrap();

        let aberto = topico(&harness, &channels[0], &owner.id, "Aberto").await;
        let fechado = topico(&harness, &privado, &owner.id, "Fechado").await;

        let do_membro = harness.list_threads(&member_session, &server.id, false).await;
        assert_eq!(do_membro, vec![aberto.id().to_string()]);

        let do_dono = harness.list_threads(&owner_session, &server.id, false).await;
        assert_eq!(do_dono.len(), 2);
        assert!(do_dono.iter().any(|id| id == fechado.id()));
    }

    /// `archived` separa os dois recortes: nenhum tópico aparece nos dois.
    #[rocket::async_test]
    async fn arquivado_separa_os_recortes() {
        let harness = TestHarness::new().await;
        let (_, session, owner) = harness.new_user().await;
        let (server, channels) = harness.new_server(&owner).await;

        let ativo = topico(&harness, &channels[0], &owner.id, "Ativo").await;
        let mut arquivado = topico(&harness, &channels[0], &owner.id, "Arquivado").await;
        let mut info = arquivado.thread().unwrap().clone();
        info.archived = true;
        arquivado
            .update(
                &harness.db,
                PartialChannel {
                    thread: Some(info),
                    ..Default::default()
                },
                vec![],
            )
            .await
            .unwrap();

        assert_eq!(
            harness.list_threads(&session, &server.id, false).await,
            vec![ativo.id().to_string()]
        );
        assert_eq!(
            harness.list_threads(&session, &server.id, true).await,
            vec![arquivado.id().to_string()]
        );
    }
}
