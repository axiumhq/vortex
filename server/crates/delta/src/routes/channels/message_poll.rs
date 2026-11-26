//! Enquete em mensagem (Vortex).
//!
//! Criar é o mesmo `POST /channels/<id>/messages` com o campo `poll` — assim a
//! enquete passa por idempotência, modo lento e reconciliação por nonce como
//! qualquer mensagem. Aqui ficam só votar e encerrar.

use revolt_database::{
    util::{permissions::DatabasePermissionQuery, reference::Reference},
    Database, User,
};
use revolt_models::v0;
use revolt_permissions::{calculate_channel_permissions, ChannelPermission};
use revolt_result::{create_error, Result};
use rocket::{serde::json::Json, State};
use rocket_empty::EmptyResponse;

/// # Vote On Poll
///
/// Replace your vote on a message's poll. An empty list removes the vote.
#[openapi(tag = "Interactions")]
#[put("/<target>/messages/<msg>/poll/votes", data = "<data>")]
pub async fn vote_poll(
    db: &State<Database>,
    user: User,
    target: Reference<'_>,
    msg: Reference<'_>,
    data: Json<v0::DataPollVote>,
) -> Result<EmptyResponse> {
    let channel = target.as_channel(db).await?;
    let mut query = DatabasePermissionQuery::new(db, &user).channel(&channel);
    calculate_channel_permissions(&mut query)
        .await
        .throw_if_lacking_channel_permission(ChannelPermission::ViewChannel)?;

    let message = msg.as_message_in_channel(db, channel.id()).await?;
    message
        .vote_poll(db, &user, data.into_inner().answers)
        .await
        .map(|_| EmptyResponse)
}

/// # End Poll
///
/// Stop a message's poll from accepting votes. Its author or anyone with
/// `ManageMessages` may end it.
#[openapi(tag = "Interactions")]
#[post("/<target>/messages/<msg>/poll/end")]
pub async fn end_poll(
    db: &State<Database>,
    user: User,
    target: Reference<'_>,
    msg: Reference<'_>,
) -> Result<EmptyResponse> {
    let channel = target.as_channel(db).await?;
    let mut message = msg.as_message_in_channel(db, channel.id()).await?;

    if message.author != user.id {
        let mut query = DatabasePermissionQuery::new(db, &user).channel(&channel);
        let permissions = calculate_channel_permissions(&mut query).await;
        if !permissions.has_channel_permission(ChannelPermission::ManageMessages) {
            return Err(create_error!(MissingPermission {
                permission: ChannelPermission::ManageMessages.to_string()
            }));
        }
    }

    message.end_poll(db).await.map(|_| EmptyResponse)
}

#[cfg(test)]
mod test {
    use crate::{rocket, util::test::TestHarness};
    use iso8601_timestamp::{Duration, Timestamp};
    use revolt_database::{
        events::client::EventV1, util::reference::Reference, Channel, Member, PartialMember,
        PartialMessage, Poll, Server, Session, User,
    };
    use revolt_models::v0;
    use revolt_permissions::{ChannelPermission, OverrideField};
    use revolt_result::ErrorType;
    use rocket::http::{ContentType, Header, Method, Status};
    use serde_json::{json, Value};

    struct Cenario {
        harness: TestHarness,
        autor: (Session, User),
        outro: (Session, User),
        server: Server,
        channel: Channel,
    }

    /// Servidor com o autor da enquete e um segundo membro sem cargo.
    async fn cenario() -> Cenario {
        let harness = TestHarness::new().await;
        let (_, sessao_autor, autor) = harness.new_user().await;
        let (_, sessao_outro, outro) = harness.new_user().await;
        let (server, channels) = harness.new_server(&autor).await;
        let (_, channels) = Member::create(&harness.db, &server, &autor, Some(channels))
            .await
            .expect("`Member` autor");
        Member::create(&harness.db, &server, &outro, None)
            .await
            .expect("`Member` outro");

        Cenario {
            harness,
            autor: (sessao_autor, autor),
            outro: (sessao_outro, outro),
            server,
            channel: channels[0].clone(),
        }
    }

    async fn pedir(
        harness: &TestHarness,
        sessao: &Session,
        metodo: Method,
        url: String,
        corpo: Option<Value>,
    ) -> (Status, String) {
        let mut pedido = harness
            .client
            .req(metodo, url)
            .header(Header::new("x-session-token", sessao.token.to_string()));
        if let Some(corpo) = corpo {
            pedido = pedido.header(ContentType::JSON).body(corpo.to_string());
        }
        let resposta = pedido.dispatch().await;
        let status = resposta.status();
        (status, resposta.into_string().await.unwrap_or_default())
    }

    fn tipo_do_erro(corpo: &str) -> String {
        serde_json::from_str::<Value>(corpo)
            .ok()
            .and_then(|erro| erro["type"].as_str().map(str::to_string))
            .unwrap_or_else(|| panic!("corpo não é um erro: {corpo}"))
    }

    async fn criar(c: &Cenario, enquete: Value) -> (Status, String) {
        pedir(
            &c.harness,
            &c.autor.0,
            Method::Post,
            format!("/channels/{}/messages", c.channel.id()),
            Some(json!({ "poll": enquete })),
        )
        .await
    }

    async fn criar_ok(c: &Cenario, enquete: Value) -> v0::Message {
        let (status, corpo) = criar(c, enquete).await;
        assert_eq!(status, Status::Ok, "{corpo}");
        serde_json::from_str(&corpo).expect("`v0::Message`")
    }

    async fn votar(
        c: &Cenario,
        sessao: &Session,
        msg: &str,
        respostas: &[&str],
    ) -> (Status, String) {
        pedir(
            &c.harness,
            sessao,
            Method::Put,
            format!("/channels/{}/messages/{msg}/poll/votes", c.channel.id()),
            Some(json!({ "answers": respostas })),
        )
        .await
    }

    async fn encerrar(c: &Cenario, sessao: &Session, msg: &str) -> (Status, String) {
        pedir(
            &c.harness,
            sessao,
            Method::Post,
            format!("/channels/{}/messages/{msg}/poll/end", c.channel.id()),
            None,
        )
        .await
    }

    async fn enquete_gravada(c: &Cenario, msg: &str) -> Poll {
        Reference::from_unchecked(msg)
            .as_message(&c.harness.db)
            .await
            .expect("`Message`")
            .poll
            .expect("a mensagem perdeu a enquete")
    }

    fn votos(enquete: &Poll, resposta: &str) -> Vec<String> {
        enquete
            .votes
            .get(resposta)
            .map(|quem| quem.iter().cloned().collect())
            .unwrap_or_default()
    }

    fn duas_respostas() -> Value {
        json!({ "question": "Qual?", "answers": ["A", "B"] })
    }

    async fn esperar_voto(c: &mut Cenario, msg: &str, usuario: &str, respostas: &[&str]) {
        let canal = c.channel.id().to_string();
        c.harness
            .wait_for_event(&canal, |evento| match evento {
                EventV1::MessagePollVote {
                    id,
                    channel_id,
                    user_id,
                    answers,
                } => {
                    id == msg
                        && channel_id == &canal
                        && user_id == usuario
                        && answers
                            .iter()
                            .map(String::as_str)
                            .eq(respostas.iter().copied())
                }
                _ => false,
            })
            .await;
    }

    async fn esperar_encerramento(c: &mut Cenario, msg: &str) -> v0::Poll {
        let canal = c.channel.id().to_string();
        match c
            .harness
            .wait_for_event(
                &canal,
                |evento| matches!(evento, EventV1::MessagePollEnd { id, .. } if id == msg),
            )
            .await
        {
            EventV1::MessagePollEnd { poll, .. } => poll,
            _ => unreachable!(),
        }
    }

    #[rocket::async_test]
    async fn criar_com_enquete() {
        let mut c = cenario().await;
        let mensagem = criar_ok(
            &c,
            json!({
                "question": "  Qual?  ",
                "answers": ["A", " B "],
                "max_answers": 2,
                "duration_hours": 2,
                "hide_results": true
            }),
        )
        .await;

        let enquete = mensagem
            .poll
            .clone()
            .expect("a resposta não trouxe a enquete");
        assert_eq!(enquete.question, "Qual?");
        assert_eq!(
            enquete
                .answers
                .iter()
                .map(|r| (r.id.as_str(), r.text.as_str()))
                .collect::<Vec<_>>(),
            vec![("r0", "A"), ("r1", "B")]
        );
        assert_eq!(enquete.max_answers, 2);
        assert!(enquete.hide_results);
        assert!(enquete.ended_at.is_none());
        assert!(enquete.votes.is_empty());

        let vence = enquete.expires_at.expect("enquete sem prazo");
        let agora = Timestamp::now_utc();
        assert!(vence > agora.checked_add(Duration::minutes(119)).unwrap());
        assert!(vence < agora.checked_add(Duration::minutes(121)).unwrap());

        let gravada = enquete_gravada(&c, &mensagem.id).await;
        assert_eq!(gravada.question, "Qual?");

        let canal = c.channel.id().to_string();
        let evento = c.harness.wait_for_message(&canal).await;
        assert_eq!(evento.id, mensagem.id);
        assert_eq!(evento.poll.map(|p| p.question), Some("Qual?".to_string()));
    }

    #[rocket::async_test]
    async fn criar_aplica_os_padroes() {
        let c = cenario().await;
        let enquete = criar_ok(&c, duas_respostas()).await.poll.unwrap();
        assert_eq!(enquete.max_answers, 1);
        assert!(!enquete.hide_results);

        let vence = enquete.expires_at.expect("enquete sem prazo");
        let agora = Timestamp::now_utc();
        assert!(vence > agora.checked_add(Duration::hours(23)).unwrap());
        assert!(vence < agora.checked_add(Duration::hours(25)).unwrap());
    }

    #[rocket::async_test]
    async fn criar_rejeita_enquete_invalida() {
        let c = cenario().await;
        let respostas = |n: usize| (0..n).map(|i| format!("r{i}")).collect::<Vec<_>>();

        let invalidas = [
            (
                "pergunta vazia",
                json!({ "question": "", "answers": ["A", "B"] }),
            ),
            (
                "pergunta só de espaço",
                json!({ "question": "   ", "answers": ["A", "B"] }),
            ),
            (
                "pergunta com 301",
                json!({ "question": "p".repeat(301), "answers": ["A", "B"] }),
            ),
            ("uma resposta", json!({ "question": "Q", "answers": ["A"] })),
            (
                "onze respostas",
                json!({ "question": "Q", "answers": respostas(11) }),
            ),
            (
                "resposta vazia",
                json!({ "question": "Q", "answers": ["A", "  "] }),
            ),
            (
                "resposta com 101",
                json!({ "question": "Q", "answers": ["A", "r".repeat(101)] }),
            ),
            (
                "max_answers 0",
                json!({ "question": "Q", "answers": ["A", "B"], "max_answers": 0 }),
            ),
            (
                "max_answers acima das respostas",
                json!({ "question": "Q", "answers": ["A", "B"], "max_answers": 3 }),
            ),
            (
                "duração 0",
                json!({ "question": "Q", "answers": ["A", "B"], "duration_hours": 0 }),
            ),
            (
                "duração 769",
                json!({ "question": "Q", "answers": ["A", "B"], "duration_hours": 769 }),
            ),
        ];

        for (caso, enquete) in invalidas {
            let (status, corpo) = criar(&c, enquete).await;
            assert_eq!(status, Status::BadRequest, "{caso}: {corpo}");
            assert_eq!(tipo_do_erro(&corpo), "FailedValidation", "{caso}");
        }

        // Os limites exatos passam.
        let limites = [
            json!({ "question": "p".repeat(300), "answers": respostas(10), "max_answers": 10 }),
            json!({ "question": "Q", "answers": ["A", "r".repeat(100)], "duration_hours": 1 }),
            json!({ "question": "Q", "answers": ["A", "B"], "duration_hours": 768 }),
        ];
        for enquete in limites {
            criar_ok(&c, enquete).await;
        }
    }

    #[rocket::async_test]
    async fn voto_substitui_o_anterior() {
        let mut c = cenario().await;
        let msg = criar_ok(
            &c,
            json!({ "question": "Q", "answers": ["A", "B", "C"], "max_answers": 2 }),
        )
        .await
        .id;
        let (sessao, usuario) = c.outro.clone();

        let (status, corpo) = votar(&c, &sessao, &msg, &["r0"]).await;
        assert_eq!(status, Status::NoContent, "{corpo}");
        esperar_voto(&mut c, &msg, &usuario.id, &["r0"]).await;

        let (status, corpo) = votar(&c, &sessao, &msg, &["r1", "r2"]).await;
        assert_eq!(status, Status::NoContent, "{corpo}");
        esperar_voto(&mut c, &msg, &usuario.id, &["r1", "r2"]).await;

        let enquete = enquete_gravada(&c, &msg).await;
        assert!(votos(&enquete, "r0").is_empty());
        assert_eq!(votos(&enquete, "r1"), vec![usuario.id.clone()]);
        assert_eq!(votos(&enquete, "r2"), vec![usuario.id.clone()]);

        // Votar de novo numa resposta já escolhida não duplica o voto.
        let (status, _) = votar(&c, &sessao, &msg, &["r1"]).await;
        assert_eq!(status, Status::NoContent);
        let enquete = enquete_gravada(&c, &msg).await;
        assert_eq!(votos(&enquete, "r1"), vec![usuario.id.clone()]);
        assert!(votos(&enquete, "r2").is_empty());
    }

    #[rocket::async_test]
    async fn voto_vazio_retira() {
        let mut c = cenario().await;
        let msg = criar_ok(&c, duas_respostas()).await.id;
        let (sessao, usuario) = c.outro.clone();

        votar(&c, &sessao, &msg, &["r1"]).await;
        let (status, corpo) = votar(&c, &sessao, &msg, &[]).await;
        assert_eq!(status, Status::NoContent, "{corpo}");
        esperar_voto(&mut c, &msg, &usuario.id, &[]).await;

        let enquete = enquete_gravada(&c, &msg).await;
        assert!(votos(&enquete, "r0").is_empty());
        assert!(votos(&enquete, "r1").is_empty());
    }

    #[rocket::async_test]
    async fn respostas_repetidas_sao_deduplicadas() {
        let mut c = cenario().await;
        let msg = criar_ok(&c, duas_respostas()).await.id;
        let (sessao, usuario) = c.outro.clone();

        // max_answers é 1: a repetição só passa porque conta uma vez.
        let (status, corpo) = votar(&c, &sessao, &msg, &["r0", "r0"]).await;
        assert_eq!(status, Status::NoContent, "{corpo}");
        esperar_voto(&mut c, &msg, &usuario.id, &["r0"]).await;

        let enquete = enquete_gravada(&c, &msg).await;
        assert_eq!(votos(&enquete, "r0"), vec![usuario.id.clone()]);
    }

    #[rocket::async_test]
    async fn voto_invalido_e_rejeitado_sem_gravar() {
        let c = cenario().await;
        let msg = criar_ok(&c, duas_respostas()).await.id;
        let sessao = c.outro.0.clone();

        let (status, corpo) = votar(&c, &sessao, &msg, &["r9"]).await;
        assert_eq!(status, Status::BadRequest, "{corpo}");
        assert_eq!(tipo_do_erro(&corpo), "InvalidProperty");

        let (status, corpo) = votar(&c, &sessao, &msg, &["r0", "r1"]).await;
        assert_eq!(status, Status::BadRequest, "{corpo}");
        assert_eq!(tipo_do_erro(&corpo), "InvalidProperty");

        let enquete = enquete_gravada(&c, &msg).await;
        assert!(votos(&enquete, "r0").is_empty());
        assert!(votos(&enquete, "r1").is_empty());
    }

    #[rocket::async_test]
    async fn votar_em_enquete_encerrada() {
        let c = cenario().await;
        let msg = criar_ok(&c, duas_respostas()).await.id;

        let (status, corpo) = encerrar(&c, &c.autor.0, &msg).await;
        assert_eq!(status, Status::NoContent, "{corpo}");

        let (status, corpo) = votar(&c, &c.outro.0, &msg, &["r0"]).await;
        assert_eq!(status, Status::BadRequest, "{corpo}");
        assert_eq!(tipo_do_erro(&corpo), "InvalidOperation");
        assert!(votos(&enquete_gravada(&c, &msg).await, "r0").is_empty());
    }

    #[rocket::async_test]
    async fn votar_em_enquete_vencida() {
        let c = cenario().await;
        let msg = criar_ok(&c, duas_respostas()).await.id;

        let mut mensagem = Reference::from_unchecked(&msg)
            .as_message(&c.harness.db)
            .await
            .expect("`Message`");
        let mut vencida = mensagem.poll.clone().expect("enquete");
        vencida.expires_at = Timestamp::now_utc().checked_sub(Duration::minutes(1));
        mensagem
            .update(
                &c.harness.db,
                PartialMessage {
                    poll: Some(vencida),
                    ..Default::default()
                },
                vec![],
            )
            .await
            .expect("vencer a enquete");

        let (status, corpo) = votar(&c, &c.outro.0, &msg, &["r0"]).await;
        assert_eq!(status, Status::BadRequest, "{corpo}");
        assert_eq!(tipo_do_erro(&corpo), "InvalidOperation");
        assert!(votos(&enquete_gravada(&c, &msg).await, "r0").is_empty());

        // Vencida também não se encerra: já não aceita votos.
        let (status, corpo) = encerrar(&c, &c.autor.0, &msg).await;
        assert_eq!(status, Status::BadRequest, "{corpo}");
        assert_eq!(tipo_do_erro(&corpo), "InvalidOperation");
    }

    /// A corrida votar × encerrar: o voto foi validado contra uma leitura em
    /// que a enquete estava aberta, e a escrita chega depois do encerramento.
    #[rocket::async_test]
    async fn voto_lido_aberto_nao_entra_depois_de_encerrar() {
        let c = cenario().await;
        let msg = criar_ok(&c, duas_respostas()).await.id;

        let leitura_antiga = Reference::from_unchecked(&msg)
            .as_message(&c.harness.db)
            .await
            .expect("`Message`");
        assert!(leitura_antiga.poll.as_ref().expect("enquete").is_open());

        let (status, corpo) = encerrar(&c, &c.autor.0, &msg).await;
        assert_eq!(status, Status::NoContent, "{corpo}");

        let erro = leitura_antiga
            .vote_poll(&c.harness.db, &c.outro.1, vec!["r0".to_string()])
            .await
            .expect_err("o voto entrou numa enquete encerrada");
        assert!(
            matches!(erro.error_type, ErrorType::InvalidOperation),
            "{erro:?}"
        );

        let enquete = enquete_gravada(&c, &msg).await;
        assert!(enquete.ended_at.is_some());
        assert!(votos(&enquete, "r0").is_empty());
    }

    /// A mesma corrida contra o prazo: a escrita confere o vencimento no
    /// banco, não na leitura que o modelo já tinha.
    #[rocket::async_test]
    async fn voto_lido_aberto_nao_entra_depois_de_vencer() {
        let c = cenario().await;
        let msg = criar_ok(&c, duas_respostas()).await.id;

        let leitura_antiga = Reference::from_unchecked(&msg)
            .as_message(&c.harness.db)
            .await
            .expect("`Message`");

        let mut mensagem = leitura_antiga.clone();
        let mut vencida = mensagem.poll.clone().expect("enquete");
        vencida.expires_at = Timestamp::now_utc().checked_sub(Duration::minutes(1));
        mensagem
            .update(
                &c.harness.db,
                PartialMessage {
                    poll: Some(vencida),
                    ..Default::default()
                },
                vec![],
            )
            .await
            .expect("vencer a enquete");

        let erro = leitura_antiga
            .vote_poll(&c.harness.db, &c.outro.1, vec!["r0".to_string()])
            .await
            .expect_err("o voto entrou numa enquete vencida");
        assert!(
            matches!(erro.error_type, ErrorType::InvalidOperation),
            "{erro:?}"
        );
        assert!(votos(&enquete_gravada(&c, &msg).await, "r0").is_empty());
    }

    #[rocket::async_test]
    async fn autor_encerra() {
        let mut c = cenario().await;
        let msg = criar_ok(&c, duas_respostas()).await.id;
        let (sessao, usuario) = c.outro.clone();
        let (status, _) = votar(&c, &sessao, &msg, &["r1"]).await;
        assert_eq!(status, Status::NoContent);

        let (status, corpo) = encerrar(&c, &c.autor.0, &msg).await;
        assert_eq!(status, Status::NoContent, "{corpo}");

        // O evento leva a enquete inteira, com os votos já gravados.
        let enquete = esperar_encerramento(&mut c, &msg).await;
        assert!(enquete.ended_at.is_some());
        assert_eq!(
            enquete
                .votes
                .get("r1")
                .map(|quem| quem.iter().cloned().collect::<Vec<_>>()),
            Some(vec![usuario.id.clone()])
        );

        assert!(enquete_gravada(&c, &msg).await.ended_at.is_some());
    }

    #[rocket::async_test]
    async fn outro_membro_sem_permissao_nao_encerra() {
        let c = cenario().await;
        let msg = criar_ok(&c, duas_respostas()).await.id;

        let (status, corpo) = encerrar(&c, &c.outro.0, &msg).await;
        assert_eq!(status, Status::Forbidden, "{corpo}");
        assert_eq!(tipo_do_erro(&corpo), "MissingPermission");
        assert!(enquete_gravada(&c, &msg).await.ended_at.is_none());
    }

    #[rocket::async_test]
    async fn quem_gerencia_mensagens_encerra() {
        let mut c = cenario().await;
        let msg = criar_ok(&c, duas_respostas()).await.id;

        let (_, sessao, moderador) = c.harness.new_user().await;
        let (membro, _) = Member::create(&c.harness.db, &c.server, &moderador, None)
            .await
            .expect("`Member` moderador");
        let cargo = c
            .harness
            .new_role(
                &c.server,
                1,
                Some(OverrideField {
                    a: ChannelPermission::ManageMessages as i64,
                    d: 0,
                }),
            )
            .await;
        c.harness
            .db
            .update_member(
                &membro.id,
                &PartialMember {
                    avatar: None,
                    id: None,
                    joined_at: None,
                    nickname: None,
                    pronouns: None,
                    roles: Some(vec![cargo.id.clone()]),
                    timeout: None,
                    can_publish: None,
                    can_receive: None,
                    show_tag: None,
                },
                vec![],
            )
            .await
            .expect("cargo no moderador");

        let (status, corpo) = encerrar(&c, &sessao, &msg).await;
        assert_eq!(status, Status::NoContent, "{corpo}");
        esperar_encerramento(&mut c, &msg).await;
        assert!(enquete_gravada(&c, &msg).await.ended_at.is_some());
    }

    #[rocket::async_test]
    async fn encerrar_duas_vezes() {
        let c = cenario().await;
        let msg = criar_ok(&c, duas_respostas()).await.id;

        let (status, _) = encerrar(&c, &c.autor.0, &msg).await;
        assert_eq!(status, Status::NoContent);
        let primeiro = enquete_gravada(&c, &msg).await.ended_at;

        let (status, corpo) = encerrar(&c, &c.autor.0, &msg).await;
        assert_eq!(status, Status::BadRequest, "{corpo}");
        assert_eq!(tipo_do_erro(&corpo), "InvalidOperation");
        assert_eq!(enquete_gravada(&c, &msg).await.ended_at, primeiro);
    }
}
