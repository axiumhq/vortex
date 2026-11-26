use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use fred::clients::SubscriberClient;
use fred::interfaces::{ClientLike, EventInterface, PubsubInterface};
use fred::types::{ReconnectPolicy, RedisConfig};
use rand::RngExt;
use revolt_database::util::email::normalise_email;
use revolt_database::util::password::hash_password;
use revolt_database::{
    events::client::EventV1, Channel, Database, Member, Message, PartialRole, PartialServer,
    Server, User, AMQP,
};
use revolt_database::{util::idempotency::IdempotencyKey, Role};
use revolt_database::{Account, EmailVerification, Session};
use revolt_models::v0;
use revolt_permissions::OverrideField;
use rocket::http::Header;
use rocket::local::asynchronous::{Client, LocalRequest, LocalResponse};
use rocket::tokio;
use rocket::tokio::sync::{broadcast::error::RecvError, mpsc};
use serde::{Deserialize, Serialize};

/// Quanto `wait_for_event` espera antes de reprovar o teste.
const ESPERA_POR_EVENTO: Duration = Duration::from_secs(10);

/// Só o campo `type` de um evento, lido do JSON cru.
///
/// A mensagem de falha da espera lista os TIPOS recebidos e nunca o conteúdo:
/// eventos carregam conta, sessão e e-mail, e logar isso — mesmo em teste — é
/// vazamento de dado em texto claro.
#[derive(Deserialize)]
struct TipoDeEvento {
    #[serde(rename = "type")]
    tipo: String,
}

/// Um evento recebido: tópico, tipo (para diagnóstico) e o evento decodificado.
type Recebido = (String, String, EventV1);

pub struct TestHarness {
    pub client: Client,
    pub db: Database,
    pub amqp: AMQP,
    /// Mantido vivo pelo tempo do harness: soltá-lo encerra a assinatura.
    _sub: SubscriberClient,
    /// Eventos já decodificados, drenados do Redis por uma tarefa própria.
    eventos: mpsc::UnboundedReceiver<Recebido>,
    /// Mensagens que o canal de broadcast do `fred` descartou por atraso.
    perdidos: Arc<AtomicU64>,
    event_buffer: Vec<(String, EventV1)>,
    /// Tópico e tipo de cada evento em `event_buffer`, sem o conteúdo.
    tipos_recebidos: Vec<(String, String)>,
}

impl TestHarness {
    pub async fn new() -> TestHarness {
        let client = Client::tracked(crate::web().await)
            .await
            .expect("valid rocket instance");

        let (sub, eventos, perdidos) = TestHarness::assinar_eventos().await;

        let db = client
            .rocket()
            .state::<Database>()
            .expect("`Database`")
            .clone();

        let amqp = AMQP::new_auto().await;

        TestHarness {
            client,
            db,
            amqp,
            _sub: sub,
            eventos,
            perdidos,
            event_buffer: vec![],
            tipos_recebidos: vec![],
        }
    }

    /// Assina todos os tópicos (`*`) ANTES de devolver, para que nenhum
    /// evento gerado pelo teste chegue antes da assinatura.
    ///
    /// Antes isto era um `PubSub` do `redis` 0.23 lido com `on_message()`, que
    /// monta um leitor NOVO a cada chamada: os bytes que o leitor anterior (ou
    /// a resposta do `PSUBSCRIBE`) já tinha tirado do socket se perdiam, o
    /// leitor seguinte começava no meio de uma mensagem, o parser falhava e o
    /// stream terminava — o `unreachable!()` intermitente do CI. Com o tráfego
    /// de todos os testes paralelos chegando por `*`, a chance de um corte no
    /// meio da mensagem era alta.
    ///
    /// Agora é o `SubscriberClient` do `fred` (o mesmo do bonfire), com
    /// reconexão e reassinatura automáticas, e uma tarefa que drena as
    /// mensagens continuamente para um canal sem limite — o socket nunca fica
    /// sem leitura enquanto o teste faz requisições.
    async fn assinar_eventos() -> (
        SubscriberClient,
        mpsc::UnboundedReceiver<Recebido>,
        Arc<AtomicU64>,
    ) {
        let config = RedisConfig::from_url(&redis_kiss::REDIS_URI).expect("`REDIS_URI`");
        let mut builder = fred::types::Builder::from_config(config);
        builder.set_policy(ReconnectPolicy::new_exponential(0, 100, 2_000, 2));
        builder.with_performance_config(|c| c.broadcast_channel_capacity = 65_536);
        let sub = builder
            .build_subscriber_client()
            .expect("`SubscriberClient`");
        sub.init().await.expect("conexão de pub/sub com o Redis");
        sub.manage_subscriptions();

        // O receptor nasce antes do `PSUBSCRIBE`: nada publicado depois da
        // confirmação da assinatura fica sem destino.
        let mut mensagens = sub.message_rx();
        let (tx, eventos) = mpsc::unbounded_channel();
        let perdidos = Arc::new(AtomicU64::new(0));
        let contador = perdidos.clone();
        tokio::spawn(async move {
            loop {
                match mensagens.recv().await {
                    Ok(mensagem) => {
                        let topico = mensagem.channel.to_string();
                        let decodificado = mensagem.value.as_str().and_then(|texto| {
                            let tipo = serde_json::from_str::<TipoDeEvento>(&texto).ok()?;
                            let evento = serde_json::from_str::<EventV1>(&texto).ok()?;
                            Some((tipo.tipo, evento))
                        });
                        let Some((tipo, evento)) = decodificado else {
                            // Só o tópico: o conteúdo pode trazer dado de conta.
                            eprintln!("evento ilegível em `{topico}`");
                            continue;
                        };
                        if tx.send((topico, tipo, evento)).is_err() {
                            break;
                        }
                    }
                    Err(RecvError::Lagged(n)) => {
                        contador.fetch_add(n, Ordering::Relaxed);
                    }
                    Err(RecvError::Closed) => break,
                }
            }
        });

        sub.psubscribe("*").await.expect("`PSUBSCRIBE *`");
        (sub, eventos, perdidos)
    }

    /// O que já passou pelo harness, para a mensagem de falha da espera.
    ///
    /// Só TIPOS e tópicos, nunca o conteúdo dos eventos (ver `TipoDeEvento`).
    fn resumo_da_espera(&self, topic: &str) -> String {
        let no_topico: Vec<&str> = self
            .tipos_recebidos
            .iter()
            .filter(|(t, _)| t == topic)
            .map(|(_, tipo)| tipo.as_str())
            .collect();
        let outros = self.tipos_recebidos.len() - no_topico.len();
        let ultimos: Vec<String> = self
            .tipos_recebidos
            .iter()
            .rev()
            .filter(|(t, _)| t != topic)
            .take(10)
            .map(|(t, tipo)| format!("{t}: {tipo}"))
            .collect();
        format!(
            "tipos recebidos em `{topic}`: {no_topico:?}
             eventos em outros tópicos: {outros} (últimos: {ultimos:?})
             mensagens descartadas por atraso: {}",
            self.perdidos.load(Ordering::Relaxed)
        )
    }

    pub fn rand_string() -> String {
        rand::rng()
            .sample_iter(rand::distr::Alphanumeric)
            .take(20)
            .map(char::from)
            .collect()
    }

    pub async fn new_user(&self) -> (Account, Session, User) {
        let user = User::create(&self.db, TestHarness::rand_string(), None, None)
            .await
            .expect("`User`");

        let (account, session) = self.account_from_user(user.id.clone()).await;

        (account, session, user)
    }

    pub async fn account_from_user(&self, id: String) -> (Account, Session) {
        let email = format!("{}@stoat.chat", TestHarness::rand_string());
        let account = Account {
            id,
            email: email.clone(),
            password: hash_password("password_insecure".to_string()).unwrap(),
            email_normalised: normalise_email(email),
            deletion: None,
            disabled: false,
            lockout: None,
            mfa: Default::default(),
            password_reset: None,
            verification: EmailVerification::Verified,
        };

        self.db.save_account(&account).await.expect("`Account`");

        let session = account
            .create_session(&self.db, String::new())
            .await
            .expect("`Session`");

        (account, session)
    }

    pub async fn new_server(&self, user: &User) -> (Server, Vec<Channel>) {
        Server::create(
            &self.db,
            v0::DataCreateServer {
                name: "Test Server".to_string(),
                ..Default::default()
            },
            user,
            true,
        )
        .await
        .expect("Failed to create test server")
    }

    pub async fn new_role(
        &self,
        server: &Server,
        _rank: i64,
        overrides: Option<OverrideField>,
    ) -> Role {
        let mut role = Role::create(&self.db, server, TestHarness::rand_string())
            .await
            .expect("Failed to create test role");

        if let Some(overrides) = overrides {
            role.update(
                &self.db,
                &server.id,
                PartialRole {
                    permissions: Some(overrides),
                    ..Default::default()
                },
                Vec::new(),
            )
            .await
            .expect("Failed to set test role overrides");
        };

        role
    }

    /// Vortex: servidor que libera DM entre membros, com `membros` dentro.
    pub async fn new_server_with_member_dms(&self, owner: &User, membros: &[&User]) -> Server {
        let (mut server, _) = self.new_server(owner).await;
        server
            .update(
                &self.db,
                PartialServer {
                    security: Some(v0::ServerSecurity {
                        allow_member_dms: true,
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                vec![],
            )
            .await
            .expect("`Server` security");
        for membro in membros {
            Member::create(&self.db, &server, membro, None)
                .await
                .expect("`Member`");
        }
        server
    }

    /// Vortex: grava a privacidade por servidor de alguém, no formato do cliente.
    pub async fn set_server_privacy(&self, user: &User, json: serde_json::Value) {
        let settings = std::collections::HashMap::from([(
            revolt_database::util::privacidade_do_servidor::CHAVE.to_string(),
            (1_i64, json.to_string()),
        )]);
        self.db
            .set_user_settings(&user.id, &settings)
            .await
            .expect("`UserSettings`");
    }

    pub async fn new_channel(&self, server: &Server) -> Channel {
        Channel::create_server_channel(
            &self.db,
            &mut server.clone(),
            v0::DataCreateServerChannel {
                channel_type: v0::LegacyServerChannelType::Text,
                name: "Test Channel".to_string(),
                description: None,
                nsfw: Some(false),
                voice: None,
            },
            true,
        )
        .await
        .expect("Failed to make test channel")
    }

    pub async fn new_message(
        &self,
        user: &User,
        server: &Server,
        channels: Vec<Channel>,
    ) -> (Channel, Member, Message) {
        let (member, channels) = Member::create(&self.db, server, user, Some(channels))
            .await
            .expect("Failed to create member");
        let channel = &channels[0];
        let message = Message::create_from_api(
            &self.db,
            None,
            channel.clone(),
            v0::DataMessageSend {
                content: Some("Test message".to_string()),
                nonce: None,
                attachments: None,
                stickers: None,
                replies: None,
                embeds: None,
                masquerade: None,
                interactions: None,
                flags: None,
                poll: None,
            },
            v0::MessageAuthor::User(&user.clone().into(&self.db, Some(user)).await),
            Some(user.clone().into(&self.db, Some(user)).await),
            Some(member.clone().into()),
            user.limits().await,
            IdempotencyKey::unchecked_from_string("0".to_string()),
            false,
            false,
        )
        .await
        .expect("Failed to create message");
        (channel.clone(), member, message)
    }

    pub async fn with_session(session: Session, request: LocalRequest<'_>) -> LocalResponse<'_> {
        request
            .header(Header::new("x-session-token", session.token.to_string()))
            .dispatch()
            .await
    }

    /// Vortex: ids dos tópicos do servidor que `session` enxerga em
    /// `GET /servers/:id/threads` — ativos, ou arquivados com `archived`.
    pub async fn list_threads(&self, session: &Session, server: &str, archived: bool) -> Vec<String> {
        let response = self
            .client
            .get(format!("/servers/{server}/threads?archived={archived}"))
            .header(Header::new("x-session-token", session.token.to_string()))
            .dispatch()
            .await;
        assert_eq!(response.status(), rocket::http::Status::Ok);
        let list: v0::ThreadListResponse =
            response.into_json().await.expect("`ThreadListResponse`");
        list.threads
            .iter()
            .map(|thread| thread.id().to_string())
            .collect()
    }

    /// Vortex: tópicos, FORA de `topico`, em que um evento que casa com
    /// `predicate` já passou pelo buffer. Serve para provar AUSÊNCIA depois
    /// de esperar um sentinela publicado por último.
    pub fn eventos_fora_de<F>(&self, topico: &str, predicate: F) -> Vec<String>
    where
        F: Fn(&EventV1) -> bool,
    {
        self.event_buffer
            .iter()
            .filter(|(t, e)| t != topico && predicate(e))
            .map(|(t, _)| t.clone())
            .collect()
    }

    pub async fn wait_for_event<F>(&mut self, topic: &str, predicate: F) -> EventV1
    where
        F: Fn(&EventV1) -> bool,
    {
        for (msg_topic, event) in &self.event_buffer {
            if topic == msg_topic && predicate(event) {
                // does not remove from buffer
                return event.clone();
            }
        }

        let prazo = tokio::time::Instant::now() + ESPERA_POR_EVENTO;
        loop {
            match tokio::time::timeout_at(prazo, self.eventos.recv()).await {
                Ok(Some((msg_topic, tipo, payload))) => {
                    if topic == msg_topic && predicate(&payload) {
                        return payload;
                    }

                    self.tipos_recebidos.push((msg_topic.clone(), tipo));
                    self.event_buffer.push((msg_topic, payload));
                }
                Ok(None) => panic!(
                    "a assinatura de eventos do Redis encerrou esperando `{topic}`.
{}",
                    self.resumo_da_espera(topic)
                ),
                Err(_) => panic!(
                    "nenhum evento em `{topic}` satisfez o predicado em {ESPERA_POR_EVENTO:?}.
{}",
                    self.resumo_da_espera(topic)
                ),
            }
        }
    }

    pub async fn assert_email(&self, mailbox: &str) -> (Mail, String) {
        // Wait a moment for maildev to catch the email

        tokio::time::sleep(Duration::from_secs(1)).await;

        let client = reqwest::Client::new();
        let results = client
            .get("http://localhost:14080/email")
            .send()
            .await
            .unwrap()
            .json::<Vec<Mail>>()
            .await
            .unwrap();

        let re = regex::Regex::new(r"\[\[([A-Za-z0-9_-]*)\]\]").unwrap();

        for entry in results.into_iter().rev() {
            if entry.envelope.to[0].address == mailbox {
                client
                    .delete(format!("http://localhost:14080/delete/{}", entry.id))
                    .send()
                    .await
                    .unwrap();

                let code = re.captures_iter(&entry.text).next().unwrap()[1].to_string();

                return (entry, code);
            }
        }

        panic!("Email not found.")
    }

    pub async fn wait_for_message(&mut self, channel_id: &str) -> v0::Message {
        // Só tópico e tipos: o conteúdo dos eventos traz conta e sessão.
        eprintln!(
            "esperando mensagem em `{channel_id}`.\n{}",
            self.resumo_da_espera(channel_id)
        );

        match self
            .wait_for_event(channel_id, |event| match event {
                EventV1::Message(v0::Message { channel, .. }) => channel == channel_id,
                _ => false,
            })
            .await
        {
            EventV1::Message(message) => message,
            _ => unreachable!(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Mail {
    pub id: String,
    pub envelope: MailEnvelope,
    pub subject: String,
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MailEnvelope {
    pub from: MailAddress,
    pub to: Vec<MailAddress>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MailAddress {
    pub address: String,
}
