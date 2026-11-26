use std::net::{Ipv4Addr, SocketAddr};

use axum::{middleware::from_fn_with_state, Router};

use axum_macros::FromRef;
use revolt_database::{Database, DatabaseInfo};
use revolt_ratelimits::axum as ratelimiter;
use tokio::net::TcpListener;
use utoipa::{
    openapi::security::{ApiKey, ApiKeyValue, SecurityScheme},
    Modify, OpenApi,
};
use utoipa_scalar::Scalar;

mod api;
pub mod clamav;
pub mod exif;
pub mod metadata;
pub mod mime_type;
mod ratelimits;
mod utils;

#[derive(FromRef, Clone)]
struct AppState {
    database: Database,
    ratelimit_storage: ratelimiter::RatelimitStorage,
}

#[tokio::main]
async fn main() -> Result<(), std::io::Error> {
    // Configure logging and environment
    revolt_config::configure!(files);

    // Wait for ClamAV
    clamav::init().await;

    // Configure API schema
    #[derive(OpenApi)]
    #[openapi(
        modifiers(&SecurityAddon),
        paths(
            api::root,
            api::upload_file,
            api::fetch_preview,
            api::fetch_file
        ),
        components(
            schemas(
                revolt_result::Error,
                revolt_result::ErrorType,
                api::RootResponse,
                api::Tag,
                api::UploadPayload,
                api::UploadResponse
            )
        ),
        tags(
            // (name = "Files", description = "File uploads API")
        )
    )]
    struct ApiDoc;

    struct SecurityAddon;

    impl Modify for SecurityAddon {
        fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
            if let Some(components) = openapi.components.as_mut() {
                components.add_security_scheme(
                    "bot_token",
                    SecurityScheme::ApiKey(ApiKey::Header(ApiKeyValue::new("X-Bot-Token"))),
                );
                components.add_security_scheme(
                    "session_token",
                    SecurityScheme::ApiKey(ApiKey::Header(ApiKeyValue::new("X-Session-Token"))),
                );
            }
        }
    }

    // Connect to the database
    let db = DatabaseInfo::Auto.connect().await.unwrap();
    let ratelimits = ratelimiter::RatelimitStorage::new(ratelimits::AutumnRatelimits);

    let state = AppState {
        database: db,
        ratelimit_storage: ratelimits,
    };

    // Configure Axum and router
    let app = Router::new()
        .route("/scalar", scalar_route(Scalar::new(ApiDoc::openapi()).to_html()))
        .merge(api::router().await)
        .merge(ratelimiter::routes())
        .layer(from_fn_with_state(
            state.clone(),
            ratelimiter::ratelimit_middleware,
        ))
        .with_state(state);

    // Configure TCP listener and bind
    let address = SocketAddr::from((Ipv4Addr::UNSPECIFIED, 14704));
    let listener = TcpListener::bind(&address).await?;
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await
}

/// Rota que serve a página do Scalar. A integração `axum` do `utoipa-scalar`
/// 0.1 é presa ao axum 0.7, então o HTML é servido direto.
fn scalar_route<S: Clone + Send + Sync + 'static>(html: String) -> axum::routing::MethodRouter<S> {
    axum::routing::get(move || std::future::ready(axum::response::Html(html.clone())))
}
