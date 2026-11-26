use std::time::Duration;

use futures::StreamExt;
use rand::RngExt;
use redis_kiss::redis::aio::PubSub;
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
use serde::{Deserialize, Serialize};

pub struct TestHarness {
    pub client: Client,
    pub db: Database,
    pub amqp: AMQP,
    sub: PubSub,
    event_buffer: Vec<(String, EventV1)>,
}

impl TestHarness {
    pub async fn new() -> TestHarness {
        let client = Client::tracked(crate::web().await)
            .await
            .expect("valid rocket instance");

        let mut sub = redis_kiss::open_pubsub_connection()
            .await
            .expect("`PubSub`");

        sub.psubscribe("*").await.unwrap();

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
            sub,
            event_buffer: vec![],
        }
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

        let mut stream = self.sub.on_message();
        while let Some(item) = stream.next().await {
            let msg_topic = item.get_channel_name();
            let payload: EventV1 = redis_kiss::decode_payload(&item).unwrap();

            if topic == msg_topic && predicate(&payload) {
                return payload;
            }

            self.event_buffer.push((msg_topic.to_string(), payload));
        }

        // WARNING: if predicate is never satisfied, this will never return
        //          should add a timeout for events so tests can fail gracefully

        unreachable!()
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
        dbg!(&self.event_buffer);

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
