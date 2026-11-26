use std::{collections::HashSet, sync::LazyLock};

use lettre::{
    transport::smtp::{authentication::Credentials, client::Tls},
    SmtpTransport,
};
use regex::Regex;
use revolt_config::{config, ApiSmtp};
use revolt_result::Result;

static SPLIT: LazyLock<Regex> = LazyLock::new(|| Regex::new("([^@]+)(@.+)").unwrap());
static SYMBOL_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new("\\+.+|\\.").unwrap());
static HANDLEBARS: LazyLock<handlebars::Handlebars<'static>> =
    LazyLock::new(handlebars::Handlebars::new);
static REVOLT_SOURCE_LIST: LazyLock<HashSet<String>> = LazyLock::new(|| {
    include_str!("../../assets/revolt_source_list.txt")
        .split('\n')
        .map(|x| x.into())
        .collect()
});

/// Strip special characters and aliases from emails
pub fn normalise_email(original: String) -> String {
    let split = SPLIT.captures(&original).unwrap();
    let mut clean = SYMBOL_RE
        .replace_all(split.get(1).unwrap().as_str(), "")
        .to_string();

    clean.push_str(split.get(2).unwrap().as_str());
    clean.to_lowercase()
}

/// Email template
#[derive(Clone)]
pub struct Template {
    /// Title of the email
    pub title: String,
    /// Plain text version of this email
    pub text: String,
    /// HTML version of this email
    pub html: Option<String>,
    /// URL to redirect people to from the email
    ///
    /// Use `{{url}}` to fill this field.
    ///
    /// Any given URL will be suffixed with a unique token if applicable.
    ///
    /// e.g. `https://example.com?t=` becomes `https://example.com?t=UNIQUE_CODE`
    pub url: String,
}

/// Email templates
#[derive(Clone)]
pub struct Templates {
    /// Template for email verification
    pub verify: Template,
    /// Template for password reset
    pub reset: Template,
    /// Template for password reset when the account already exists on creation
    pub reset_existing: Template,
    /// Template for account deletion
    pub deletion: Template,
    /// Template for suspention
    pub suspension: Template,
}

pub async fn email_templates() -> Templates {
    let config = config().await;

    if std::env::var("TEST_DB").is_ok() {
        Templates {
            verify: Template {
                title: "verify".into(),
                text: "[[{{url}}]]".into(),
                url: "".into(),
                html: None,
            },
            reset: Template {
                title: "reset".into(),
                text: "[[{{url}}]]".into(),
                url: "".into(),
                html: None,
            },
            reset_existing: Template {
                title: "reset_existing".into(),
                text: "[[{{url}}]]".into(),
                url: "".into(),
                html: None,
            },
            deletion: Template {
                title: "deletion".into(),
                text: "[[{{url}}]]".into(),
                url: "".into(),
                html: None,
            },
            suspension: Template {
                title: "suspension".into(),
                text: "[[dummy]]".into(),
                url: "".into(),
                html: None,
            },
        }
    } else {
        vortex_templates(&config.hosts.app)
    }
}

fn vortex_templates(app_host: &str) -> Templates {
    Templates {
        verify: Template {
            title: "Confirme seu e-mail no Vortex".into(),
            text: include_str!("../../templates/verify.txt").into(),
            url: format!("{app_host}/verificar/"),
            html: Some(include_str!("../../templates/verify.html").into()),
        },
        reset: Template {
            title: "Redefina sua senha do Vortex".into(),
            text: include_str!("../../templates/reset.txt").into(),
            url: format!("{app_host}/redefinir/"),
            html: Some(include_str!("../../templates/reset.html").into()),
        },
        reset_existing: Template {
            title: "Já existe uma conta Vortex com este e-mail".into(),
            text: include_str!("../../templates/reset-existing.txt").into(),
            url: format!("{app_host}/redefinir/"),
            html: Some(include_str!("../../templates/reset-existing.html").into()),
        },
        deletion: Template {
            title: "Confirme a exclusão da sua conta Vortex".into(),
            text: include_str!("../../templates/deletion.txt").into(),
            url: format!("{app_host}/delete/"),
            html: Some(include_str!("../../templates/deletion.html").into()),
        },
        suspension: Template {
            title: "Sua conta Vortex foi suspensa".into(),
            text: include_str!("../../templates/suspension.txt").into(),
            url: String::new(),
            html: Some(include_str!("../../templates/suspension.html").into()),
        },
    }
}

/// Create SMTP transport
pub fn create_transport(smtp: &ApiSmtp) -> SmtpTransport {
    let relay = if smtp.use_starttls == Some(true) {
        SmtpTransport::starttls_relay(&smtp.host).unwrap()
    } else {
        SmtpTransport::relay(&smtp.host).unwrap()
    };

    let relay = if let Some(port) = smtp.port {
        relay.port(port.try_into().unwrap())
    } else {
        relay
    };

    let relay = if smtp.use_tls == Some(false) {
        relay.tls(Tls::None)
    } else {
        relay
    };

    relay
        .credentials(Credentials::new(
            smtp.username.clone(),
            smtp.password.clone(),
        ))
        .build()
}

/// Render an email template
fn render_template(text: &str, variables: &handlebars::JsonValue) -> Result<String> {
    HANDLEBARS
        .render_template(text, variables)
        .map_err(|_| create_error!(RenderFail))
}

/// Send an email
pub fn send_email(
    smtp: &ApiSmtp,
    address: String,
    template: &Template,
    variables: handlebars::JsonValue,
) -> Result<()> {
    let m = lettre::Message::builder()
        .from(smtp.from_address.parse().expect("valid `smtp_from`"))
        .to(address.parse().expect("valid `smtp_to`"))
        .subject(template.title.clone());

    // Variável de ambiente vazia (`REVOLT__API__SMTP__REPLY_TO=`) chega como
    // `Some("")`, e `"".parse()` falhava no `expect`: criar conta devolvia 500.
    // Vazio ou só espaços é ausência.
    let reply_to = smtp
        .reply_to
        .as_deref()
        .map(str::trim)
        .filter(|reply_to| !reply_to.is_empty());

    let m = if let Some(reply_to) = reply_to {
        m.reply_to(reply_to.parse().expect("valid `smtp_reply_to`"))
    } else {
        m
    };

    let text = render_template(&template.text, &variables).expect("valid `template`");

    let m = if let Some(html) = &template.html {
        m.multipart(lettre::message::MultiPart::alternative_plain_html(
            text,
            render_template(html, &variables).expect("valid `template`"),
        ))
    } else {
        m.body(text)
    }
    .expect("valid `message`");

    use lettre::Transport;
    let sender = create_transport(smtp);

    match sender.send(&m) {
        Ok(_) => Ok(()),
        Err(error) => {
            // Sem o endereço: e-mail é dado pessoal e não vai para o log.
            error!("Failed to send email!\nlettre error: {}", error);

            revolt_config::capture_error(&error);

            Err(create_error!(EmailFailed))
        }
    }
}

pub fn validate_email(email: &str) -> Result<()> {
    // Make sure this is an actual email
    if !validator::validate_email(email) {
        return Err(create_error!(IncorrectData {
            with: "email".to_string()
        }));
    }

    // Check if the email is blacklisted
    if let Some(domain) = email.split('@').next_back() {
        if REVOLT_SOURCE_LIST.contains(&domain.to_string()) {
            return Err(create_error!(Blacklisted));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{render_template, vortex_templates};

    #[test]
    fn vortex_templates_are_branded_multipart_and_render_context() {
        let templates = vortex_templates("https://vortex.example");
        let actionable = [
            &templates.verify,
            &templates.reset,
            &templates.reset_existing,
            &templates.deletion,
        ];

        assert_eq!(templates.verify.url, "https://vortex.example/verificar/");
        assert_eq!(templates.reset.url, "https://vortex.example/redefinir/");
        assert_eq!(templates.deletion.url, "https://vortex.example/delete/");

        for template in actionable {
            let variables = json!({
                "email": "pessoa@example.com",
                "url": format!("{}token", template.url),
            });
            let text = render_template(&template.text, &variables).unwrap();
            let html = render_template(template.html.as_deref().unwrap(), &variables).unwrap();

            for rendered in [text, html] {
                assert!(rendered.contains("pessoa@example.com"));
                assert!(rendered.contains(&format!("{}token", template.url)));
            }
        }

        let suspension = render_template(
            templates.suspension.html.as_deref().unwrap(),
            &json!({
                "email": "pessoa@example.com",
                "list": "motivo",
                "duration": 2,
                "duration_display": "block",
            }),
        )
        .unwrap();
        assert!(suspension.contains("pessoa@example.com"));
    }

    #[test]
    fn active_templates_do_not_reference_upstream_brands() {
        let templates = vortex_templates("https://vortex.example");

        for template in [
            templates.verify,
            templates.reset,
            templates.reset_existing,
            templates.deletion,
            templates.suspension,
        ] {
            let artifact = format!("{}\n{}", template.text, template.html.unwrap());
            let artifact = artifact.to_ascii_lowercase();
            assert!(!artifact.contains("stoat"));
            assert!(!artifact.contains("revolt"));
            assert!(!artifact.contains("stoat.chat"));
        }
    }
}
