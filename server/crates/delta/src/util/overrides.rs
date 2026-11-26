//! Vortex: sobreposições de permissão de categoria e a sincronia com canais.
//!
//! A categoria não entra no cálculo de permissão — `revolt_permissions` segue
//! lendo só servidor, cargo e canal. Ela GUARDA um conjunto de sobreposições e
//! o copia para os canais. Um canal está "sincronizado" quando o conjunto dele
//! é igual ao da categoria; mudar a categoria arrasta junto só os canais que
//! estavam sincronizados, e os que divergiram de propósito ficam como estão.
//!
//! A troca é deliberada: mexer no motor de permissão alteraria o que TODO
//! cliente Stoat vê, e o bonfire decide visibilidade de canal pelo mesmo
//! cálculo. Copiar mantém o protocolo antigo verdadeiro — um cliente que não
//! conhece categoria com permissão lê o canal e acerta.

use std::collections::{HashMap, HashSet};

use revolt_database::{Channel, Database, FieldsChannel, PartialChannel, Server};
use revolt_permissions::{Override, OverrideField, PermissionValue};
use revolt_result::{create_error, Result};

/// Confere se quem pede pode trocar um conjunto de sobreposições por outro.
///
/// Mesmas regras das rotas de permissão de canal: não se concede o que não se
/// tem, e só se mexe em cargo abaixo do seu. Cargo que já não existe pode ser
/// REMOVIDO do conjunto (senão uma categoria antiga ficaria presa a ele), nunca
/// acrescentado.
#[allow(clippy::too_many_arguments)]
pub async fn check_override_changes(
    permissions: &PermissionValue,
    server: &Server,
    user_id: &str,
    our_ranking: i64,
    before_default: Option<OverrideField>,
    before_roles: &HashMap<String, OverrideField>,
    after_default: Option<OverrideField>,
    after_roles: &HashMap<String, OverrideField>,
) -> Result<()> {
    if before_default != after_default {
        permissions
            .throw_permission_override(
                before_default.map(Override::from),
                &Override::from(after_default.unwrap_or_default()),
            )
            .await?;
    }

    let is_owner = server.owner == user_id;
    let role_ids = before_roles
        .keys()
        .chain(after_roles.keys())
        .collect::<HashSet<&String>>();

    for role_id in role_ids {
        let before = before_roles.get(role_id).copied();
        let after = after_roles.get(role_id).copied();

        if before == after {
            continue;
        }

        let Some(role) = server.roles.get(role_id) else {
            if after.is_some() {
                return Err(create_error!(InvalidRole));
            }

            continue;
        };

        if !is_owner && role.rank <= our_ranking {
            return Err(create_error!(NotElevated));
        }

        permissions
            .throw_permission_override(
                before.map(Override::from),
                &Override::from(after.unwrap_or_default()),
            )
            .await?;
    }

    Ok(())
}

/// Forma canônica de um conjunto: sobreposição `{a: 0, d: 0}` não decide nada
/// e vale o mesmo que ausente.
///
/// Sem isto "sincronizado" dependeria de COMO se chegou ao estado: remover um
/// cargo de um canal pelas rotas antigas grava `{0, 0}` em vez de apagar a
/// chave, e o canal pareceria divergir da categoria para sempre.
pub fn normalize(
    default: Option<OverrideField>,
    roles: &HashMap<String, OverrideField>,
) -> (Option<OverrideField>, HashMap<String, OverrideField>) {
    let empty = OverrideField::default();

    (
        default.filter(|value| *value != empty),
        roles
            .iter()
            .filter(|(_, value)| **value != empty)
            .map(|(role, value)| (role.clone(), *value))
            .collect(),
    )
}

/// O canal tem este conjunto de sobreposições, a menos de entradas vazias?
pub fn has_overrides(
    channel: &Channel,
    default: Option<OverrideField>,
    roles: &HashMap<String, OverrideField>,
) -> bool {
    match channel {
        Channel::TextChannel {
            default_permissions,
            role_permissions,
            ..
        } => normalize(*default_permissions, role_permissions) == normalize(default, roles),
        _ => false,
    }
}

/// Substitui o conjunto de sobreposições do canal, com um evento só.
///
/// Devolve o antes e o depois para o registro de auditoria.
pub async fn apply_overrides(
    db: &Database,
    channel: &mut Channel,
    default: Option<OverrideField>,
    roles: &HashMap<String, OverrideField>,
) -> Result<(PartialChannel, PartialChannel)> {
    if !matches!(channel, Channel::TextChannel { .. }) {
        return Err(create_error!(InvalidOperation));
    }

    let partial = PartialChannel {
        default_permissions: default,
        role_permissions: Some(roles.clone()),
        ..Default::default()
    };

    let remove = if default.is_none() {
        vec![FieldsChannel::DefaultPermissions]
    } else {
        vec![]
    };

    let before = channel.generate_diff(&partial, &remove);
    channel.update(db, partial.clone(), remove).await?;

    Ok((before, partial))
}

/// Vortex: copia as sobreposições do canal para os tópicos dele.
///
/// O tópico nasce com a cópia das sobreposições do pai (`Channel::create_thread`)
/// e o cálculo de permissão só lê o próprio canal — então, sem esta cópia, um
/// canal que vira privado deixaria os tópicos dele abertos para quem perdeu o
/// acesso. Cada tópico alterado emite o próprio `ChannelUpdate`.
///
/// Canal que não é de servidor, ou que já é tópico, não tem tópicos: não faz
/// nada.
pub async fn propagate_to_threads(db: &Database, parent: &Channel) -> Result<()> {
    let Channel::TextChannel {
        id,
        server,
        default_permissions,
        role_permissions,
        thread: None,
        ..
    } = parent
    else {
        return Ok(());
    };

    let threads = db
        .fetch_threads(std::slice::from_ref(server), Some(id), None)
        .await?;

    for mut thread in threads {
        if has_overrides(&thread, *default_permissions, role_permissions) {
            continue;
        }

        apply_overrides(db, &mut thread, *default_permissions, role_permissions).await?;
    }

    Ok(())
}
