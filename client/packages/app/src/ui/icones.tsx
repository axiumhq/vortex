import {
  AppWindow as LAppWindow,
  ArrowLeft as LArrowLeft,
  AtSign as LAtSign,
  Ban as LBan,
  ScrollText as LScrollText,
  Bell as LBell,
  BellOff as LBellOff,
  ChartBar as LChartBar,
  Check as LCheck,
  ChevronDown as LChevronDown,
  ChevronLeft as LChevronLeft,
  ChevronRight as LChevronRight,
  ChevronUp as LChevronUp,
  CircleAlert as LCircleAlert,
  CircleCheck as LCircleCheck,
  Mail as LMail,
  QrCode as LQrCode,
  Copy as LCopy,
  Download as LDownload,
  File as LFile,
  Eye as LEye,
  MessageSquareDot as LMessageSquareDot,
  EyeOff as LEyeOff,
  Crown as LCrown,
  Ellipsis as LEllipsis,
  GripVertical as LGripVertical,
  Hash as LHash,
  Image as LImage,
  HeadphoneOff as LHeadphoneOff,
  Headphones as LHeadphones,
  House as LHouse,
  Lock as LLock,
  Timer as LTimer,
  LogOut as LLogOut,
  Maximize2 as LMaximize2,
  Minus as LMinus,
  MessageSquare as LMessageSquare,
  Mic as LMic,
  MicOff as LMicOff,
  Monitor as LMonitor,
  MonitorUp as LMonitorUp,
  Link as LLink,
  Palette as LPalette,
  Pause as LPause,
  Play as LPlay,
  Pencil as LPencil,
  Phone as LPhone,
  PhoneOff as LPhoneOff,
  PictureInPicture2 as LPictureInPicture2,
  Pin as LPin,
  PinOff as LPinOff,
  Plus as LPlus,
  Reply as LReply,
  SendHorizontal as LSendHorizontal,
  Smile as LSmile,
  SquareArrowOutDownLeft as LSquareArrowOutDownLeft,
  SquareArrowOutDownRight as LSquareArrowOutDownRight,
  SquareArrowOutUpLeft as LSquareArrowOutUpLeft,
  SquareArrowOutUpRight as LSquareArrowOutUpRight,
  Search as LSearch,
  Settings as LSettings,
  Shield as LShield,
  Trash2 as LTrash2,
  Trophy as LTrophy,
  User as LUser,
  Users as LUsers,
  Video as LVideo,
  WifiOff as LWifiOff,
  VideoOff as LVideoOff,
  Volume2 as LVolume2,
  VolumeX as LVolumeX,
  X as LX,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

/**
 * Ponto único de ícone (TRD §7). Único arquivo que importa `lucide-react`.
 *
 * O design system pede traço de 1,8 em grade 24, pontas redondas e quatro
 * tamanhos. O wrapper fixa tudo isso: `strokeWidth={1.8}` com
 * `absoluteStrokeWidth`, que mantém o traço visual em 1,8px em qualquer
 * tamanho (o atributo `stroke-width` do SVG sai escalado para compensar o
 * `viewBox` de 24). Quem usa só escolhe o tamanho, e só entre os quatro.
 */
export const TAMANHOS_DE_ICONE = [14, 16, 18, 20] as const;
export type TamanhoDeIcone = (typeof TAMANHOS_DE_ICONE)[number];

export const ESPESSURA_DO_TRACO = 1.8;

export type IconeProps = Omit<
  LucideProps,
  "size" | "strokeWidth" | "absoluteStrokeWidth" | "color" | "ref"
> & {
  /** Um dos quatro tamanhos do design system. Padrão 16. */
  tamanho?: TamanhoDeIcone;
};

export type Icone = (props: IconeProps) => React.JSX.Element;

/**
 * Decorativo por padrão (`aria-hidden`). Quem passa `aria-label` quer o ícone
 * como único conteúdo do controle, então ele deixa de ser escondido.
 */
function envolver(Base: LucideIcon): Icone {
  return function IconeDoVortex({ tamanho = 16, ...props }: IconeProps) {
    const rotulado = props["aria-label"] !== undefined;
    return (
      <Base
        aria-hidden={rotulado ? undefined : true}
        {...props}
        size={tamanho}
        strokeWidth={ESPESSURA_DO_TRACO}
        absoluteStrokeWidth
      />
    );
  };
}

export const SetaEsquerda = envolver(LArrowLeft);
export const Arroba = envolver(LAtSign);
export const Sino = envolver(LBell);
export const SinoMudo = envolver(LBellOff);
export const Marcar = envolver(LCheck);
export const Enquete = envolver(LChartBar);
export const SetaParaBaixo = envolver(LChevronDown);
export const SetaParaEsquerda = envolver(LChevronLeft);
export const SetaParaDireita = envolver(LChevronRight);
export const SetaParaCima = envolver(LChevronUp);
export const Copiar = envolver(LCopy);
export const Baixar = envolver(LDownload);
export const Arquivo = envolver(LFile);
export const Fixar = envolver(LPin);
export const Desafixar = envolver(LPinOff);
export const Alerta = envolver(LCircleAlert);
export const Confirmado = envolver(LCircleCheck);
export const Email = envolver(LMail);
export const CodigoQrIcone = envolver(LQrCode);
export const Olho = envolver(LEye);
export const OlhoFechado = envolver(LEyeOff);
export const SemConexao = envolver(LWifiOff);
export const Coroa = envolver(LCrown);
export const Trofeu = envolver(LTrophy);
export const MaisHorizontal = envolver(LEllipsis);
export const Alca = envolver(LGripVertical);
export const Canal = envolver(LHash);
export const FoneDesligado = envolver(LHeadphoneOff);
export const Fone = envolver(LHeadphones);
export const Casa = envolver(LHouse);
export const Cadeado = envolver(LLock);
export const ModoLento = envolver(LTimer);
export const Sair = envolver(LLogOut);
export const Maximizar = envolver(LMaximize2);
export const Minimizar = envolver(LMinus);
export const Mensagem = envolver(LMessageSquare);
export const Microfone = envolver(LMic);
export const MicrofoneDesligado = envolver(LMicOff);
export const CompartilharTela = envolver(LMonitorUp);
export const Tela = envolver(LMonitor);
export const Janela = envolver(LAppWindow);
export const Editar = envolver(LPencil);
export const EncerrarChamada = envolver(LPhoneOff);
export const Telefone = envolver(LPhone);
/** O fone girado, como no design: recusar e desligar sem o risco do "sem sinal" de EncerrarChamada. */
export const TelefoneDesligando: Icone = function TelefoneDesligando({ style, ...props }: IconeProps) {
  return <Telefone {...props} style={{ ...style, transform: "rotate(135deg)" }} />;
};
export const Proibido = envolver(LBan);
export const Registro = envolver(LScrollText);
export const ImagemSobreImagem = envolver(LPictureInPicture2);
export const Mais = envolver(LPlus);
export const Buscar = envolver(LSearch);
export const Configuracoes = envolver(LSettings);
export const Escudo = envolver(LShield);
export const Lixeira = envolver(LTrash2);
export const Pessoas = envolver(LUsers);
export const Pessoa = envolver(LUser);
export const Paleta = envolver(LPalette);
export const Elo = envolver(LLink);
export const Camera = envolver(LVideo);
export const Reproduzir = envolver(LPlay);
export const Pausar = envolver(LPause);
export const CameraDesligada = envolver(LVideoOff);
export const Volume = envolver(LVolume2);
export const VolumeDesligado = envolver(LVolumeX);
export const Fechar = envolver(LX);
export const NaoLida = envolver(LMessageSquareDot);
export const Imagem = envolver(LImage);
export const Responder = envolver(LReply);
export const Enviar = envolver(LSendHorizontal);
export const Sorriso = envolver(LSmile);
export const CantoSuperiorEsquerdo = envolver(LSquareArrowOutUpLeft);
export const CantoSuperiorDireito = envolver(LSquareArrowOutUpRight);
export const CantoInferiorEsquerdo = envolver(LSquareArrowOutDownLeft);
export const CantoInferiorDireito = envolver(LSquareArrowOutDownRight);
