#!/bin/sh
# Instalador do Vortex para Linux.
# - Baixa apenas por HTTPS (TLS 1.2+) da última release oficial no GitHub.
# - Valida a integridade do arquivo via SHA-256 (SHA256SUMS-linux.txt).
# - Detecta pacman (Arch), apt (Ubuntu/Debian) ou usa .zip em ~/.local.
# - Rodar novamente atualiza para a versão mais recente.
set -eu

BASE="https://github.com/axiumhq/vortex/releases/latest/download"
CHECKSUMS_ARQUIVO="SHA256SUMS-linux.txt"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_DESTAQUE='\033[1;36m'
  C_OK='\033[1;32m'
  C_AVISO='\033[1;33m'
  C_ERRO='\033[1;31m'
  C_FIM='\033[0m'
else
  C_DESTAQUE=''
  C_OK=''
  C_AVISO=''
  C_ERRO=''
  C_FIM=''
fi

passo() {
  printf "${C_DESTAQUE}[%s/4]${C_FIM} %s\n" "$1" "$2"
}

ok() {
  printf "${C_OK}✓${C_FIM} %s\n" "$*"
}

aviso() {
  printf "${C_AVISO}!${C_FIM} %s\n" "$*" >&2
}

erro() {
  printf "${C_ERRO}✗ Erro:${C_FIM} %s\n" "$*" >&2
  exit 1
}

baixar() {
  url="$1"
  destino="$2"
  mostrar_progresso="${3:-1}"

  if command -v curl >/dev/null 2>&1; then
    if [ "$mostrar_progresso" = "1" ]; then
      curl --proto '=https' --tlsv1.2 -fL --progress-bar "$url" -o "$destino"
    else
      curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$destino"
    fi
  elif command -v wget >/dev/null 2>&1; then
    if [ "$mostrar_progresso" = "1" ]; then
      wget --https-only --secure-protocol=TLSv1_2 -q --show-progress -O "$destino" "$url"
    else
      wget --https-only --secure-protocol=TLSv1_2 -q -O "$destino" "$url"
    fi
  else
    erro "Precisa de curl ou wget para baixar o Vortex."
  fi
}

calcular_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    erro "Precisa de sha256sum (ou shasum) para verificar a integridade do download."
  fi
}

verificar_integridade() {
  arquivo_local="$1"
  nome_esperado="$2"
  arquivo_somas="$3"

  [ -s "$arquivo_local" ] || erro "O arquivo baixado está vazio."

  esperado=$(awk -v nome="$nome_esperado" '$2 == nome || $2 == "*" nome { print $1; exit }' "$arquivo_somas")
  [ -n "$esperado" ] || erro "Não encontrei o hash SHA-256 de '$nome_esperado' em $CHECKSUMS_ARQUIVO."

  obtido=$(calcular_sha256 "$arquivo_local")
  if [ "$obtido" != "$esperado" ]; then
    erro "Falha na verificação SHA-256 de $nome_esperado (esperado: $esperado, obtido: $obtido). Instalação cancelada."
  fi
  ok "Integridade confirmada (SHA-256: ${obtido%????????????????????????????????????????????????}…)"
}

como_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    erro "Precisa de sudo (ou rodar como root) para instalar o pacote do sistema."
  fi
}

arch=$(uname -m)
case "$arch" in
  x86_64|amd64) ;;
  *) erro "Arquitetura '$arch' ainda não tem pacote Linux pronto (apenas x86_64)." ;;
esac

if command -v pacman >/dev/null 2>&1; then
  MODO="arch"
  PACOTE="Vortex.pkg.tar.zst"
  DISTRO="Arch Linux"
elif command -v apt-get >/dev/null 2>&1; then
  MODO="debian"
  PACOTE="Vortex.deb"
  DISTRO="Ubuntu/Debian"
else
  command -v unzip >/dev/null 2>&1 || erro "Precisa de 'unzip' para extrair Vortex-linux.zip."
  MODO="zip"
  PACOTE="Vortex-linux.zip"
  DISTRO="Linux (.zip)"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

passo 1 "Baixando $PACOTE para $DISTRO..."
baixar "$BASE/$PACOTE" "$tmp/$PACOTE" 1

passo 2 "Verificando integridade (SHA-256)..."
if baixar "$BASE/$CHECKSUMS_ARQUIVO" "$tmp/$CHECKSUMS_ARQUIVO" 0; then
  verificar_integridade "$tmp/$PACOTE" "$PACOTE" "$tmp/$CHECKSUMS_ARQUIVO"
elif [ "${VORTEX_PERMITIR_SEM_CHECKSUM:-0}" = "1" ]; then
  aviso "$CHECKSUMS_ARQUIVO não encontrado nesta release; continuando porque VORTEX_PERMITIR_SEM_CHECKSUM=1."
else
  erro "Não foi possível baixar $CHECKSUMS_ARQUIVO para validar o arquivo. Instalação cancelada por segurança."
fi

passo 3 "Instalando o Vortex..."
case "$MODO" in
  arch)
    como_root pacman -U --noconfirm "$tmp/$PACOTE"
    ;;
  debian)
    como_root apt-get install -y "$tmp/$PACOTE"
    ;;
  zip)
    destino="${XDG_DATA_HOME:-$HOME/.local/share}/vortex-desktop"
    bin_dir="$HOME/.local/bin"
    apps_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"

    mkdir -p "$tmp/extraido" "$bin_dir" "$apps_dir"
    unzip -q "$tmp/$PACOTE" -d "$tmp/extraido"

    binario=$(find "$tmp/extraido" -maxdepth 3 -type f -name "vortex-desktop" | head -n 1)
    [ -n "$binario" ] || erro "Não achei o executável 'vortex-desktop' dentro do .zip."
    raiz_app=$(dirname "$binario")

    rm -rf "$destino"
    mkdir -p "$destino"
    cp -a "$raiz_app"/. "$destino/"
    chmod +x "$destino/vortex-desktop"

    ln -sf "$destino/vortex-desktop" "$bin_dir/vortex-desktop"

    cat > "$apps_dir/vortex-desktop.desktop" <<EOF
[Desktop Entry]
Name=Vortex
Comment=Chat de voz e texto em tempo real
Exec=$destino/vortex-desktop %U
Terminal=false
Type=Application
Categories=Network;Chat;
EOF
    ;;
esac

passo 4 "Instalação concluída!"
ok "Vortex pronto para usar. Abra pelo menu de aplicativos ou rode 'vortex-desktop'."
