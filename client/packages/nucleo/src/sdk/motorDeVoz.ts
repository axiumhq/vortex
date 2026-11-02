/**
 * O motor de voz — o único módulo do app que importa `livekit-client`.
 *
 * ⚠ **Separado de `chamada.ts` por causa do BUNDLE, e o número é o argumento.**
 * Com o LiveKit importado estaticamente, o carregamento inicial pulou de 996 kB
 * para 1.539 kB (gzip: 303 → 444). Meio megabyte a mais em toda abertura do
 * app, para uma feature que a maioria das sessões nunca usa — e este é um
 * cliente de jornada de 8h, onde a primeira pintura importa.
 *
 * `chamada.ts` importa este arquivo com `await import()`, no primeiro clique em
 * "entrar na sala". Quem nunca entra em chamada nunca baixa o WebRTC.
 *
 * ⚠ **Só `livekit-client`, e NÃO `@livekit/components-react`.** O plano de
 * paridade previa os dois; a doutrina do projeto diz o contrário e ela ganha:
 * `component-primitives.md` lista "painel de voz e indicadores de fala" entre
 * o que se escreve à mão, e a razão é a de sempre — biblioteca de componente
 * traz modelo de dados, estilo e estado próprios, que são os três lugares onde
 * este projeto já tem decisão tomada.
 *
 * O que o LiveKit resolve e ninguém quer reescrever é o TRANSPORTE: WebRTC,
 * renegociação, seleção de codec, reconexão. Isso é `livekit-client`. O anel de
 * fala é um `boolean` num store efêmero — não paga uma segunda árvore de
 * contexto React.
 *
 * ⚠ **Nada de `Room` sai deste arquivo.** O que sai é o store de `chamada.ts`,
 * como o adapter faz com `stoat.js`.
 */
import {
  assinarPreferenciasDeVoz,
  constraintsDeAudio,
  lerPreferenciasDeVoz,
} from "../store/preferenciasDeVoz";
import {
  assinarPushToTalk,
  lerSegurando,
  microfoneAberto,
} from "../store/pushToTalk";
import {
  AudioPresets,
  createLocalAudioTrack,
  ConnectionState,
  DisconnectReason,
  Room,
  ConnectionQuality,
  LocalAudioTrack,
  LocalVideoTrack,
  RemoteVideoTrack,
  RoomEvent,
  Track,
  VideoQuality,
  type LocalParticipant,
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RoomOptions,
  type ScreenShareCaptureOptions,
  type AudioProcessorOptions,
  type TrackProcessor,
  type TrackPublishOptions,
} from "livekit-client";
import type { BackgroundProcessorWrapper } from "@livekit/track-processors";
import {
  codificacaoDe,
  constraintsDe,
  definirQualidadeEscolhida,
  esquecerQualidadeDaTela,
  pedeMovimento,
  type QualidadeDaTela,
} from "../store/qualidadeDaTela";

import {
  criarFaixaDePcm,
  ehJanela,
  ponteDeAudioDeJanela,
} from "./audioDeJanela";
import {
  atenuacaoValeAgora,
  criarAtenuador,
  ponteDeAtenuacao,
} from "./atenuacao";
import { ligarPortaDeVoz } from "./portaDeVoz";
import { client } from "./client";
import {
  lerConfigDeVoz,
  publicacaoDe as publicacaoDoCanal,
} from "./vozDoCanal";
import {
  desfazerEntradaOtimista,
  entrarNaSalaLocalmente,
  sairDaSalaLocalmente,
} from "./adapter";
import { avisarSaidaDaSala } from "./saidaDaSala";
import {
  conectarComMicrofone,
  encerrarSala,
  publicadorDaSala,
  soSeVigente,
} from "./entradaDeSala";
import { escolherNoMaisRapido, type NoDeVoz } from "./sondaDeNos";
import { registrarRemocaoImposta } from "./vozImposta";
import type { Chamada, QualidadeDeVoz } from "../store/chamada";
import { camadaDe, pediuMenos, type QualidadeDeStream } from "./camadaDeVideo";
import {
  alternarMudoNoStore,
  alternarSurdoNoStore,
  definirChamada,
  definirFalantes,
  encerrarChamada,
  lerChamada,
} from "../store/chamada";
import { definirPalco, lerPalco } from "../store/palcoDeVoz";
import { assinarVolumeEfetivo, volumeEfetivo } from "../store/volumesDeVoz";
import {
  assinarQualquerVolumeDaTransmissao,
  volumeEfetivoDaTransmissao,
} from "../store/volumesDeTransmissao";
import { criarAudioDaTransmissao } from "./audioDaTransmissao";
import { criarAssinaturaDeVideo } from "./assinaturaDeVideo";
import { pararTodos } from "./efeitosSonoros";
import {
  fonteDe,
  ligarAssinaturaDeVideo,
  publicacoesDaSala,
} from "./ligarAssinaturaDeVideo";
import { chaveDeVideo, faixasDeVideo, type FonteDeVideo } from "../store/video";
import { toast } from "../ui-logica/toastStore";
import { definirFalhaDeVoz, limparFalhaDeVoz } from "../store/falhaDeVoz";
import { ALTURA_DE, ponteDeTela } from "./seletorDeTela";
import { ponteDoMixer } from "./mixerDeApps";
import {
  concluirEscolhaDeTela,
  pedirEscolhaDeTela,
} from "../store/seletorDeTela";
import { motivoDoErro } from "./erros";
import {
  coalescer,
  fundoEfetivo,
  planoDeFundo,
  querRuidoForte,
  TAXA_DO_RNNOISE,
} from "../ui-logica/voz/processamento";
import type { SupressorDeRuido } from "../ui-logica/voz/ruidoForte";
import type { FundoDeVideo } from "../store/preferenciasDeVoz";
import {
  criarAnuncioDeAssistir,
  type AnuncioDeAssistir,
} from "./anuncioDeAssistir";
import { CHAVE_ASSISTE, decodificarAssistindo } from "./espectadores";
import {
  definirAnuncio,
  definirContagemDisponivel,
  esquecerAnuncio,
  limparEspectadores,
} from "../store/espectadores";

/**
 * O anúncio do que ESTA conexão assiste (ver `anuncioDeAssistir.ts`).
 *
 * Um por sala, como os ouvintes: nasce em `ligarEventos` e morre na saída.
 */
let anuncio: AnuncioDeAssistir | undefined;

/**
 * Espectadores: quem pode anunciar e o que cada um anuncia.
 *
 * ⚠ **A permissão da PRÓPRIA conexão decide a contagem inteira.** Servidor
 * sem o grant `can_update_own_metadata` não deixa ninguém escrever o
 * atributo; ali a contagem seria sempre zero, e a interface volta para "N na
 * sala" em vez de afirmar "0 assistindo".
 */
function lerEspectadoresDaSala(r: Room): void {
  definirContagemDisponivel(
    r.localParticipant.permissions?.canUpdateMetadata === true,
  );
  for (const p of r.remoteParticipants.values()) {
    definirAnuncio(
      p.identity,
      decodificarAssistindo(p.attributes[CHAVE_ASSISTE]),
    );
  }
}

function esquecerEspectadores(): void {
  anuncio?.limpar();
  anuncio = undefined;
  limparEspectadores();
}

function criarAnuncio(r: Room): AnuncioDeAssistir {
  return criarAnuncioDeAssistir({
    podeEscrever: () =>
      r.localParticipant.permissions?.canUpdateMetadata === true,
    escrever: (valor) =>
      r.localParticipant.setAttributes({ [CHAVE_ASSISTE]: valor }),
    aoEscrever: (lista) => {
      const eu = r.localParticipant.identity;
      if (eu) definirAnuncio(eu, lista);
    },
    telaCheia: () => document.fullscreenElement !== null,
    async medir(dono) {
      const pub = publicacaoDeVideo(dono, "tela");
      if (!pub?.isSubscribed) return undefined;
      const faixa =
        pub.track instanceof RemoteVideoTrack ? pub.track : undefined;
      /*
        A altura que CHEGA sai da estatística do receptor, e não das
        `settings` da faixa: o simulcast troca de camada sem avisar a faixa, e
        é justamente essa troca que "(rede)" existe para mostrar.
      */
      const stats = await faixa?.getReceiverStats().catch(() => undefined);
      return {
        ativa: pub.isEnabled,
        recebida:
          stats?.frameHeight ?? faixa?.mediaStreamTrack.getSettings().height,
        publicada: pub.dimensions?.height,
      };
    },
  });
}

/**
 * A sala, module-level.
 *
 * Uma por app e não uma por componente: o cartão de chamada desmonta quando a
 * pessoa navega, e uma sala presa a ele derrubaria a chamada ao trocar de
 * canal — que é exatamente o que o modo PiP existe para não fazer.
 */
let sala: Room | undefined;

/** Onde o áudio remoto toca. Um só, fora da árvore React. */
let saidaDeAudio: HTMLDivElement | undefined;

function elementoDeAudio(): HTMLDivElement {
  if (!saidaDeAudio) {
    saidaDeAudio = document.createElement("div");
    // Fora da árvore do React de propósito: o React não precisa saber que
    // existem elementos `<audio>`, e um re-render não pode reiniciá-los.
    saidaDeAudio.style.display = "none";
    document.body.appendChild(saidaDeAudio);
  }
  return saidaDeAudio;
}

/**
 * A frase de uma falha de voz.
 *
 * ⚠ **Mídia PRIMEIRO, rede depois — e a ordem é o conserto.** Antes isto
 * delegava tudo a `motivoDoErro`, que lê o envelope do Revolt (`type`,
 * `status`). Um `DOMException` não tem nenhum dos dois e caía no fallback
 * dele: **"Sem resposta do servidor. Verifique sua conexão."**
 *
 * Medido no painel do navegador, que bloqueia captura: entrar na chamada
 * falhava com o microfone negado e a interface mandava conferir a REDE. A
 * pessoa vai procurar o problema no roteador por causa de uma permissão de
 * site — frase errada com confiança, que é pior que frase genérica.
 *
 * Um tradutor só para os dois caminhos (entrar e compartilhar tela): com dois,
 * o primeiro a ganhar um caso novo divergiria do outro.
 */
function motivo(e: unknown): string {
  return motivoDeMidia(e) ?? motivoDoErro(e);
}

/** `undefined` quando não é falha de dispositivo — aí quem responde é a rede. */
function motivoDeMidia(e: unknown): string | undefined {
  if (!(e instanceof DOMException)) return undefined;
  switch (e.name) {
    case "NotAllowedError":
      return "O navegador não liberou o microfone. Confira a permissão deste site.";
    case "NotFoundError":
      return "Nenhum microfone encontrado.";
    case "NotReadableError":
      return "O sistema não liberou o microfone. Feche outros programas que estejam usando ele.";
    case "OverconstrainedError":
      return "O dispositivo escolhido nas configurações não está disponível.";
    case "AbortError":
      return "A captura foi interrompida.";
    default:
      return undefined;
  }
}

/**
 * O nó de voz mais próximo — ver `sondaDeNos.ts` (teto de tempo, pulada com
 * no máximo um nó). Sem nós declarados, `undefined` deixa o servidor escolher.
 */
async function noMaisRapido(): Promise<string | undefined> {
  const feature = (
    client.configuration as
      | { features?: { livekit?: { nodes?: NoDeVoz[] } } }
      | undefined
  )?.features?.livekit;
  return escolherNoMaisRapido(feature?.nodes ?? []);
}

/**
 * Os tetos de publicação que o CANAL escolheu — bitrate e modo de vídeo.
 *
 * ⚠ **Nos padrões da sala, e não em cada `setMicrophoneEnabled`.** O
 * microfone é publicado por mais de um caminho (entrar, sair do mudo,
 * push-to-talk), e a câmera por outro; opção por chamada teria de ser repetida
 * em cada um, e o primeiro que esquecesse publicaria no padrão do LiveKit sem
 * erro nenhum. `publishDefaults` vale para todos.
 *
 * A transmissão de tela NÃO passa por aqui: ela tem `screenShareEncoding`
 * próprio, escolhido no HUD.
 */
function opcoesDaSala(channelId: string): RoomOptions {
  const p = publicacaoDoCanal(lerConfigDeVoz(channelId));
  return {
    publishDefaults: {
      ...(p.audioMaxBitrate === undefined
        ? {}
        : { audioPreset: { maxBitrate: p.audioMaxBitrate } }),
      ...(p.video === undefined
        ? {}
        : {
            videoEncoding: {
              maxBitrate: p.video.maxBitrate,
              maxFramerate: p.video.fps,
            },
          }),
    },
    ...(p.video === undefined
      ? {}
      : {
          videoCaptureDefaults: {
            resolution: {
              width: p.video.largura,
              height: p.video.altura,
              frameRate: p.video.fps,
            },
          },
        }),
  };
}

/** Quem está na sala agora, do ponto de vista do LiveKit. */
function participantesDe(r: Room): string[] {
  const ids: string[] = [];
  const eu = r.localParticipant.identity;
  if (eu) ids.push(eu);
  for (const p of r.remoteParticipants.values()) ids.push(p.identity);
  return ids;
}

function ligarEventos(r: Room, channelId: string): void {
  /* Evento tardio de uma sala que já não é a atual (troca rápida, queda que
     chega depois do `disconnect`) não pode sobrescrever o estado da nova. */
  const vigente = () => sala === r;
  /* Escreve `channelId`/`participantes` — o que o clique em outra sala acabou
     de trocar no store — então também passa pela checagem de vigência. */
  const publicar = publicadorDaSala({
    vigente,
    canal: channelId,
    participantes: () => participantesDe(r),
    escrever: definirChamada,
  });

  anuncio?.limpar();
  anuncio = criarAnuncio(r);

  /* Os eventos que CUMPREM o pedido de vídeo — ver `ligarAssinaturaDeVideo.ts`. */
  desligarAssinaturaDeVideo?.();
  desligarAssinaturaDeVideo = ligarAssinaturaDeVideo(r, assinatura);

  /*
    Espectadores: o atributo `vx.assiste` de cada participante (ver
    `espectadores.ts`). Chega por evento, e na entrada e na reconexão é lido
    de uma vez — atributo que mudou durante uma queda não gera evento.
  */
  r.on(RoomEvent.ParticipantAttributesChanged, (mudou, participante) => {
    if (!(CHAVE_ASSISTE in mudou)) return;
    definirAnuncio(
      participante.identity,
      decodificarAssistindo(participante.attributes[CHAVE_ASSISTE]),
    );
  });
  r.on(RoomEvent.ParticipantPermissionsChanged, (_antes, participante) => {
    if (participante.identity !== r.localParticipant.identity) return;
    definirContagemDisponivel(
      participante.permissions?.canUpdateMetadata === true,
    );
  });

  r.on(RoomEvent.Connected, soSeVigente(vigente, () => {
    lerEspectadoresDaSala(r);
    definirChamada({
      estado: "dentro",
      desde: Date.now(),
      channelId,
      participantes: participantesDe(r),
    });
    publicarFontes(r);
    /* Você na lista da sala já, sem esperar o `VoiceChannelJoin` do webhook. */
    entrarNaSalaLocalmente(channelId, { publicando: deveTransmitir() });
    /*
      Entrar NÃO abre o palco. O clique já fechou a página que a pessoa estava
      lendo (`abrirSala`); reabrir a grade aqui desfazia isso. O palco só volta
      no segundo clique da mesma sala, ou quando a própria transmissão pede
      pré-visualização. Reconectar também não rouba a página: este handler é
      `Connected`, não `Reconnected`.
    */
    assinarAudioExistente(r);
  }));

  /*
    ⚠ **Sair da chamada apaga as faixas, e isto NÃO existia.**
    `encerrarChamada` zera o store de chamada e não sabe do de vídeo, então
    toda faixa — a sua e a de todo mundo — sobrevivia à sala. Ver `limpar` em
    `store/ephemeral.ts` para as duas consequências; a que morde primeiro não
    é o vazamento, é a faixa MORTA reaparecendo na chamada seguinte, porque
    as chaves (`usuário:fonte`) são estáveis entre chamadas.
  */
  r.on(RoomEvent.Disconnected, soSeVigente(vigente, (motivo?: DisconnectReason) => {
    /* Queda pelo servidor não passa por `sairDaChamada` — sem isto o ouvinte
       de volume ficaria preso a uma sala morta (erro nº 5 do briefing). */
    pararDeOuvirVolumes?.();
    pararDeOuvirVolumes = undefined;
    somDaTela.fechar();
    atenuador.atualizar(false, false, true);
    pararAudioDaJanela();
    faixasDeVideo.limpar();
    /* A contagem morre com a sala. Sem isto, entrar de novo começaria com
       assinantes fantasmas e a primeira borda nunca chegaria a zero. */
    assinatura.limpar();
    esquecerEspectadores();
    /* Queda antes do eco do servidor: o palpite não pode virar fantasma. */
    desfazerEntradaOtimista(channelId);

    /*
      ⚠ **Sair porque alguém te TIROU era indistinguível de a rede cair**, e a
      chamada sumia calada nos dois casos.

      `PARTICIPANT_REMOVED` é o que o `RoomService.RemoveParticipant` produz, e
      é exatamente o que `voice_client.remove_user` chama no servidor — nos
      DOIS caminhos de moderação: `remove: ["VoiceChannel"]` (desconectar) e
      `voice_channel` (mover, que remove do nó antigo antes de emitir o token
      do novo). Por isso quem decide a frase não é este handler: ele só relata
      o fato, e `sdk/vozImposta.ts` espera o segundo sinal antes de falar.

      Os outros motivos NÃO entram: `CLIENT_INITIATED` é a saída normal (e nem
      chega aqui, porque `sairDaChamada` remove os ouvintes antes), e queda de
      rede o SDK já traduz na faixa de conexão.
    */
    if (motivo === DisconnectReason.PARTICIPANT_REMOVED) {
      registrarRemocaoImposta({
        canal: channelId,
        nome: client.channels.get(channelId)?.name ?? "a sala",
      });
    }
    encerrarChamada();
  }));
  r.on(
    RoomEvent.Reconnecting,
    soSeVigente(vigente, () => definirChamada({ estado: "reconectando" })),
  );

  /*
    ⚠ **Reconectar RE-VARRE quem publica o quê, e não só marca "dentro".**

    `transmitindo`, `comCamera` e `mudos` são mantidos por evento
    (`TrackPublished`, `TrackUnpublished`, `TrackMuted`, `TrackUnmuted`), e
    evento que chega durante uma queda não chega. Sem esta varredura, voltar de
    uma reconexão deixaria alguém marcado como ao vivo depois de ter parado, ou
    — pior — ninguém marcado com alguém transmitindo, e o alvo "Assistir"
    simplesmente não existiria.

    É o mesmo motivo pelo qual `publicarFontes` varre a sala inteira em vez de
    somar e subtrair: reconexão é justamente quando o incremental diverge.
  */
  r.on(RoomEvent.Reconnected, soSeVigente(vigente, () => {
    definirChamada({ estado: "dentro", participantes: participantesDe(r) });
    publicarFontes(r);
    lerEspectadoresDaSala(r);
    /*
      ⚠ **E as fontes LOCAIS junto — `publicarFontes` varre só os remotos.**

      O raciocínio do comentário acima vale igual para o seu lado e não estava
      sendo aplicado: durante uma queda o LiveKit republica as suas faixas, e
      o `MediaStreamTrack` que volta costuma ser outro OBJETO. Sem esta
      varredura, `faixasDeVideo` seguia apontando para o anterior — morto — e
      a sua própria prévia ficava congelada no último quadro de antes da
      queda, no ladrilho da grade e no palco do popout.

      E os dois booleanos vão junto: se o compartilhamento não sobreviveu à
      queda, `chamada.tela` continuaria `true` e a interface afirmaria que
      você está transmitindo quando não está — que é a mesma classe de mentira
      que a varredura dos remotos existe para evitar.
    */
    rescanearFontesLocais(r.localParticipant);
    assinarAudioExistente(r);
  }));

  /*
    A qualidade da conexão, do LiveKit.

    Só a do participante LOCAL: a do outro lado é problema dele, e mostrar a
    pior de todas faria o painel acusar a sua rede quando quem está mal é
    alguém do outro continente.

    `ConnectionQuality` é classificação, não número — ver `QualidadeDeVoz` no
    store. O design mostra "42 ms"; derivar milissegundos de "good" seria dado
    falso numa superfície onde a pessoa decide se sai da chamada.
  */
  r.on(RoomEvent.ConnectionQualityChanged, (qualidade, participante) => {
    if (participante?.identity !== r.localParticipant.identity) return;
    definirChamada({ qualidade: traduzirQualidade(qualidade) });
  });

  r.on(RoomEvent.ParticipantConnected, () => {
    publicar();
    publicarFontes(r);
  });
  /*
    ⚠ **Sair da sala é diferente de parar de transmitir, e só o segundo estava
    tratado.**

    `TrackUnpublished` devolve quem assiste para a grade quando a pessoa PARA
    — mas quando ela cai, a garantia passa a depender da ordem e da chegada
    desses eventos, que numa queda de rede é justamente o que não se pode
    assumir. Sem isto, o palco ficava em "assistindo fulano" com fulano fora
    da sala: quadro congelado, sem aviso, e sem forma de saber que acabou.

    Apagar as faixas dela aqui tem a mesma razão — `TrackUnsubscribed` faz
    isso no caminho feliz, e este é o caminho em que ele pode não vir.
  */
  r.on(RoomEvent.ParticipantDisconnected, (participante) => {
    publicar();
    publicarFontes(r);

    faixasDeVideo.apagar(chaveDeVideo(participante.identity, "tela"));
    faixasDeVideo.apagar(chaveDeVideo(participante.identity, "camera"));
    /* Nas duas pontas: ela deixa de assistir, e a tela dela deixa de existir. */
    esquecerAnuncio(participante.identity);
    anuncio?.terminou(participante.identity);

    const palco = lerPalco();
    if (palco.tipo === "assistindo" && palco.userId === participante.identity) {
      definirPalco({ tipo: "grade" });
    }
  });

  /*
    ⚠ **Quem para a transmissão pode não ser o Vortex, e sem isto o app
    continuava afirmando que você estava ao vivo.**

    O Chrome desenha a própria barra — "está compartilhando sua tela · Parar de
    compartilhar" — e o Electron, o macOS e o Wayland têm as suas. Clicar ali
    encerra a faixa por fora: o LiveKit despublica e avisa, e o nosso store não
    ouvia. O botão ficava aceso, o selo de AO VIVO ficaria aceso, e o palco
    seguiria mostrando a última prévia.

    É o modo de falha que este projeto classifica como pior que a ausência: a
    interface afirmando o contrário do que está acontecendo, na pergunta de
    maior consequência que uma chamada tem — "a minha tela está sendo vista?".
  */
  /*
    ⚠ **Este é o caminho em que `alternarTela` NÃO roda**, e por isso ele
    precisa apagar a faixa do store por conta própria: parar de transmitir pelo
    botão do NAVEGADOR (ou do sistema operacional) despublica a faixa sem
    passar pela nossa função. Sem esta limpeza o store guardaria uma faixa já
    encerrada, e o ladrilho da grade e o palco do popout continuariam
    desenhando um `<video>` congelado no último quadro de uma transmissão que
    acabou — pior que o xadrez, porque parece que ainda está no ar.
  */
  r.on(RoomEvent.LocalTrackUnpublished, (pub) => {
    const local = r.localParticipant;
    /* O som da janela morre com a transmissão, pelos dois caminhos de parar —
       e com a própria faixa de áudio, se ela sair sozinha. */
    if (
      pub.source === Track.Source.ScreenShare ||
      pub.source === Track.Source.ScreenShareAudio
    ) {
      pararAudioDaJanela();
    }
    if (pub.source === Track.Source.ScreenShare) {
      definirChamada({ tela: false, telaPausada: false, telaAudio: "sem" });
      /*
        ⚠ A escolha de qualidade morre com a FAIXA, e é aqui que ela morre nos
        dois caminhos — o nosso e o do botão do navegador. A janela que
        suportava 1080p60 pode ser uma aba de 720p na vez seguinte, e o menu
        abriria marcando um degrau que a faixa nova nunca recebeu. Mesma razão
        do `limpar()` do store efêmero.
      */
      esquecerQualidadeDaTela();
      publicarVideoLocal(local, "tela", Track.Source.ScreenShare, false);
      /*
        ⚠ **Volta para a GRADE, e não fecha — regressão da mudança de
        arquitetura, corrigida aqui.** Enquanto o palco era sobreposição,
        `fecharPalco()` significava "tira essa camada da frente do app" e era
        a coisa certa. Com a sala ocupando a coluna de conteúdo, "fechado"
        passou a significar "sai da sala e mostra o chat do canal": parar de
        transmitir expulsava a pessoa da chamada que ela continua ouvindo.

        Só age se o palco mostrava a SUA transmissão — quem parou de
        transmitir pode continuar assistindo alguém.
      */
      if (lerPalco().tipo === "transmitindo") definirPalco({ tipo: "grade" });
      return;
    }
    if (pub.source === Track.Source.Camera) {
      definirChamada({ camera: false });
      /* Mesma limpeza, e a câmera tinha o mesmo furo — só era menos visível
         porque desligar a câmera quase sempre passa por `alternarCamera`. */
      publicarVideoLocal(local, "camera", Track.Source.Camera, false);
    }
  });

  /*
    ⚠ **O evento mais quente do app inteiro.**

    `ActiveSpeakersChanged` chega várias vezes por segundo por pessoa. Ele NÃO
    toca o store de chamada nem o de canais — só o efêmero, que coalesce em
    120ms. É o aviso que o `CLAUDE.md` registrou antes de esta etapa existir.
  */
  r.on(RoomEvent.ActiveSpeakersChanged, (falantes) => {
    definirFalantes(falantes.map((p) => p.identity));
    /* "Atenuar outros apps": só a fala dos OUTROS conta — você falando não
       precisa de silêncio em volta para se ouvir. */
    const outro = falantes.some((p) => p !== r.localParticipant);
    atenuador.atualizar(outro, atenuacaoLigada());
  });

  /*
    Áudio remoto: anexa num elemento fora da árvore React.

    `autoSubscribe: false` na conexão significa que nada chega sozinho — o que
    evita baixar vídeo de todo mundo ao entrar. Assinar o áudio explicitamente
    aqui é o que faz a sala ter som.
  */
  r.on(RoomEvent.TrackSubscribed, (faixa: RemoteTrack, pub, participante) => {
    if (faixa.kind === Track.Kind.Audio) {
      /*
        O som da tela tem caminho próprio: contexto de Web Audio para o ganho
        passar de 100%. Re-assinar ou reconectar entrega uma faixa NOVA, e é
        por aqui que ela recebe o contexto e o volume guardado de novo.
      */
      if (pub.source === Track.Source.ScreenShareAudio) {
        somDaTela.receber(participante.identity, faixa as RemoteAudioTrack);
        return;
      }
      elementoDeAudio().appendChild(faixa.attach());
      /*
        O volume guardado desta pessoa chega AQUI, na faixa recém-assinada.
        Antes dela não há onde aplicar, e aplicar só quando o deslizante mexe
        faria quem você baixou ontem voltar a 100% em toda chamada nova.
      */
      definirVolumeDe(participante.identity);
      return;
    }

    /*
      Video vai para o STORE, e nao para um elemento fora da arvore.

      ⚠ A diferenca com o audio nao e estilo: audio nao tem lugar na tela e
      precisa tocar mesmo com a superficie fechada; video so existe DENTRO de
      um ladrilho, e e o ladrilho que decide quando anexar. Anexar aqui daria
      um `<video>` orfao decodificando quadros que ninguem ve - o custo exato
      que `autoSubscribe: false` foi instalado para nao pagar.
    */
    const fonte = fonteDe(pub.source);
    if (!fonte) return;
    faixasDeVideo.set(
      chaveDeVideo(participante.identity, fonte),
      faixa.mediaStreamTrack,
    );
    /* Assinar a tela É assistir — o anúncio nasce na chegada da faixa. */
    if (fonte === "tela") anuncio?.comecou(participante.identity);
  });

  r.on(RoomEvent.TrackUnsubscribed, (faixa: RemoteTrack, pub, participante) => {
    if (faixa.kind === Track.Kind.Audio) {
      faixa.detach().forEach((el) => el.remove());
      return;
    }
    const fonte = fonteDe(pub.source);
    if (!fonte) return;
    if (fonte === "tela") anuncio?.terminou(participante.identity);
    /*
      ⚠ **Só apaga se a faixa guardada é ESTA.** Parar e voltar a assistir
      manda o pedido de saída e o de entrada em sequência, e o
      `TrackUnsubscribed` da faixa velha pode chegar depois do
      `TrackSubscribed` da nova. Apagar pela chave jogava fora a faixa que
      acabou de chegar, e a tela ficava em "recebendo o primeiro quadro…".
    */
    const chave = chaveDeVideo(participante.identity, fonte);
    if (faixasDeVideo.getSnapshot(chave) === faixa.mediaStreamTrack) {
      faixasDeVideo.apagar(chave);
    }
  });

  /*
    Quem publica o que.

    ⚠ **Assina so AUDIO, e o video continua entrando sob pedido.** O que mudou
    e que agora existe quem PECA: a grade e a tela de assistir chamam
    `pedirVideo`. Baixar camera de dez pessoas ao entrar continua sendo
    desperdicio puro - o design diz a mesma coisa em prosa: "quem entra no
    canal depois ve o stream com um clique, nao recebe nada automaticamente".

    O que a publicacao faz e ANUNCIAR: sem estas duas listas, uma sala onde
    alguem esta ao vivo seria indistinguivel de uma sala vazia, porque com
    `autoSubscribe: false` "existe stream" e "tenho o stream" sao fatos
    diferentes.

    O video pedido ANTES de a publicacao chegar e cumprido pelo ouvinte de
    `ligarAssinaturaDeVideo.ts`, que tambem escuta este evento.
  */
  r.on(RoomEvent.TrackPublished, (pub, participante) => {
    /*
      ⚠ **O som da tela NÃO entra com o resto do áudio.** Ele é
      `Track.Kind.Audio` como o microfone, e assinar todo áudio fazia quem não
      estava assistindo ouvir a transmissão inteira. Ele desce só para quem
      assiste — e, se chegar depois do vídeo, é aqui que o pedido acontece.
    */
    if (pub.source === Track.Source.ScreenShareAudio) {
      assinatura.audioDaTelaPublicado(participante.identity);
    } else if (pub.kind === Track.Kind.Audio) {
      pub.setSubscribed(true);
    }
    publicarFontes(r);
  });

  /*
    Mudo de outra pessoa.

    ⚠ **Estes dois eventos existem porque `TrackPublished` não cobre o caso.**
    Silenciar não despublica a faixa — ela continua lá, muda. Sem ouvir isto, o
    ícone de microfone cortado da grade só apareceria para quem entrou
    silenciado e nunca mais mudaria.
  */
  r.on(RoomEvent.TrackMuted, () => publicarFontes(r));
  r.on(RoomEvent.TrackUnmuted, () => publicarFontes(r));

  r.on(RoomEvent.TrackUnpublished, (pub, participante) => {
    const fonte = fonteDe(pub.source);
    if (fonte) faixasDeVideo.apagar(chaveDeVideo(participante.identity, fonte));
    publicarFontes(r);

    /*
      ⚠ **Quem voce esta assistindo pode parar, e o palco ficaria congelado no
      ultimo quadro sem dizer nada.** Voltar para a grade e o que o design
      chama de "parar de assistir volta para a grade sem sair da chamada" - e
      aqui nao foi voce que parou.
    */
    const p = lerPalco();
    if (
      p.tipo === "assistindo" &&
      p.userId === participante.identity &&
      pub.source === Track.Source.ScreenShare
    ) {
      definirPalco({ tipo: "grade" });
    }
  });
}

/**
 * Áudio já publicado quando você entra. `TrackPublished` cobre o que chega
 * depois; isto cobre o que já estava no ar — senão a tela compartilhada
 * toca mudo até alguém republicar.
 */
function assinarAudioExistente(r: Room): void {
  for (const p of r.remoteParticipants.values()) {
    for (const pub of p.trackPublications.values()) {
      /* O som da tela fica de fora: é de quem assiste. Ver `TrackPublished`. */
      if (
        pub.kind === Track.Kind.Audio &&
        pub.source !== Track.Source.ScreenShareAudio &&
        !pub.isSubscribed
      ) {
        pub.setSubscribed(true);
      }
    }
  }
}

/**
 * Republica quem esta com camera e quem esta transmitindo.
 *
 * ⚠ **Varre a sala inteira em vez de somar e subtrair por evento.** A lista e
 * de participantes de uma sala de voz - dezenas no pior caso -, e a soma
 * incremental e onde nasce o estado que diverge: um `TrackUnpublished` perdido
 * durante uma reconexao deixaria alguem marcado como ao vivo para sempre. A
 * varredura e O(n) sobre um n pequeno e nao tem como derivar.
 *
 * ⚠ **Compara por CONTEUDO antes de publicar.** Sem isso, cada publicacao
 * emitiria um array novo e acordaria todo mundo que assina a chamada - o
 * cartao, a faixa, o painel de usuario - a cada vez que alguem ligasse a
 * camera. E a armadilha nº 1 do briefing, na forma de lista.
 */
function publicarFontes(r: Room): void {
  const transmitindo: string[] = [];
  const telaComSom: string[] = [];
  const comCamera: string[] = [];
  const mudos: string[] = [];

  for (const p of r.remoteParticipants.values()) {
    if (p.getTrackPublication(Track.Source.ScreenShare)) {
      transmitindo.push(p.identity);
      if (p.getTrackPublication(Track.Source.ScreenShareAudio)) {
        telaComSom.push(p.identity);
      }
    }
    if (p.getTrackPublication(Track.Source.Camera)) comCamera.push(p.identity);
    /*
      ⚠ **Sem publicação de microfone TAMBÉM conta como mudo**, e não é
      detalhe: quem entra silenciado nunca publica a faixa, então perguntar só
      pelo `isMuted` da publicação existente deixaria a pessoa mais silenciosa
      da sala como a única sem o ícone.
    */
    const mic = p.getTrackPublication(Track.Source.Microphone);
    if (!mic || mic.isMuted) mudos.push(p.identity);
  }

  const atual = lerChamada();
  const mudanca: { -readonly [K in keyof Chamada]?: Chamada[K] } = {};
  if (!mesmaLista(atual.transmitindo, transmitindo)) {
    mudanca.transmitindo = transmitindo;
  }
  if (!mesmaLista(atual.telaComSom, telaComSom)) mudanca.telaComSom = telaComSom;
  if (!mesmaLista(atual.comCamera, comCamera)) mudanca.comCamera = comCamera;
  if (!mesmaLista(atual.mudos, mudos)) mudanca.mudos = mudos;
  if (Object.keys(mudanca).length > 0) definirChamada(mudanca);
}

function mesmaLista(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Quem quer cada faixa de vídeo remota. A contabilidade mora em
 * `assinaturaDeVideo.ts`, sem LiveKit, para o teste exercitar o código real.
 */
/**
 * O áudio da tela já estava na publicação quando alguém passou a assistir.
 *
 * `TrackSubscribed` não dispara de novo nesse caso, e o LiveKit trata volume 0
 * como "ainda não definido" no attach. Anexa se ninguém anexou e escreve o
 * ganho efetivo — que é 0 enquanto a pessoa está surda.
 */
function audioDaTelaJaPresente(userId: string): void {
  const faixa = publicacaoDeAudioDaTela(userId, "tela")?.track;
  if (!faixa || faixa.kind !== Track.Kind.Audio) return;
  somDaTela.receber(userId, faixa as RemoteAudioTrack);
}

const assinatura = criarAssinaturaDeVideo({
  video: publicacaoDeVideo,
  audioDaTela: publicacaoDeAudioDaTela,
  /* A camada é aplicada quando a assinatura ACONTECE, que pode ser bem depois
     do pedido: a publicação chega, a sala reconecta. */
  aplicarQualidade: definirQualidadeDeStream,
  audioDaTelaJaPresente,
});

/** Os ouvintes de `ligarAssinaturaDeVideo`, desligados na saída da sala. */
let desligarAssinaturaDeVideo: (() => void) | undefined;

/**
 * Pede a faixa de video de uma pessoa, na camada pedida, e devolve a funcao
 * que a devolve.
 *
 * ⚠ **E a unica porta para video remoto, e ela e EXPLICITA por decisao de
 * custo.** Com `autoSubscribe: false` nada de video desce sozinho; quem quer
 * ver chama isto e, ao desmontar, chama a devolucao. O som da tela vai junto,
 * sob a mesma contagem. Sem publicacao ainda, o pedido fica guardado e e
 * cumprido quando ela chegar.
 */
export function pedirVideo(
  userId: string,
  fonte: FonteDeVideo,
  qualidade: QualidadeDeStream,
): () => void {
  return assinatura.pedir(userId, fonte, qualidade);
}

/**
 * A qualidade que se aceita receber de um stream.
 *
 * ⚠ **`soAudio` e `setEnabled(false)`, e nao uma resolucao menor.** O design
 * chama de "So audio" e diz para que serve: rede ruim. `setEnabled(false)`
 * manda o servidor PARAR de enviar aquela faixa, que e a unica coisa que
 * realmente devolve banda; pedir 180p continuaria baixando video.
 */
export type { QualidadeDeStream };

export function definirQualidadeDeStream(
  userId: string,
  fonte: FonteDeVideo,
  qualidade: QualidadeDeStream,
): void {
  const pub = publicacaoDeVideo(userId, fonte);
  if (!pub) return;

  /* O espectador diz o que escolheu: "720p" pedido não é "720p (rede)", e só
     áudio deixa de contar como assistir. */
  if (fonte === "tela") anuncio?.pediuMenos(userId, pediuMenos(qualidade));

  if (qualidade === "soAudio") {
    pub.setEnabled(false);
    return;
  }
  pub.setEnabled(true);
  /*
    `auto` volta ao teto ALTO de propósito: o LiveKit ja degrada sozinho
    quando a banda nao sustenta, e o que "automatica" promete e justamente
    nao ter teto imposto por voce. Fixar MEDIUM em "auto" seria pedir 720p
    para sempre e chamar isso de automatico.
  */
  const camada = camadaDe(qualidade);
  pub.setVideoQuality(
    camada === "LOW"
      ? VideoQuality.LOW
      : camada === "MEDIUM"
        ? VideoQuality.MEDIUM
        : VideoQuality.HIGH,
  );
}

/**
 * O que está CHEGANDO do vídeo de alguém, contra o que a fonte publica.
 *
 * ⚠ **Do `RTCStatsReport` e não de `getSettings()` da faixa remota**: em
 * faixa recebida o navegador não é obrigado a preencher as dimensões, e a
 * camada que o SFU escolheu só aparece no `frameHeight` do inbound-rtp. A
 * publicada vem do `TrackInfo` do servidor — é o que decide se a fonte
 * chegou a ter 720p (ver `voz/quedaDeQualidade.ts`).
 */
export async function resolucaoRecebida(
  userId: string,
  fonte: FonteDeVideo,
): Promise<
  { recebida: number | undefined; publicada: number | undefined } | undefined
> {
  const pub = publicacaoDeVideo(userId, fonte);
  const faixa = pub?.track;
  if (!pub || !faixa || !ehVideoRemoto(faixa)) return undefined;
  const stats = await faixa.getReceiverStats().catch(() => undefined);
  return { recebida: stats?.frameHeight, publicada: pub.dimensions?.height };
}

function ehVideoRemoto(t: RemoteTrack): t is RemoteVideoTrack {
  return t.kind === Track.Kind.Video;
}

/**
 * O volume de UMA pessoa, so para voce: a voz e o som da tela dela.
 *
 * `0` e o "silenciar so para mim" do design.
 */
function definirVolumeDe(userId: string): void {
  /*
    ⚠ **A voz fica limitada a 1, e acima disso LANÇAVA.** Sem `webAudioMix` o
    LiveKit escreve em `HTMLMediaElement.volume`, que dá `IndexSizeError` fora
    de [0, 1]. Ver `VOLUME_MAXIMO` em `store/volumesDeVoz.ts`.
  */
  const ganho = Math.min(1, Math.max(0, volumeEfetivo(userId)));
  participanteRemoto(userId)?.setVolume(ganho, Track.Source.Microphone);
  /*
    O som da tela NÃO passa por `participante.setVolume`: aquele guarda o valor
    num mapa e o reaplica em toda faixa nova ANTES de ela ter contexto — um 3
    ali lançaria no `attach`. O ganho dela é o da transmissão, até 300%.
  */
  const tela = publicacaoDeAudioDaTela(userId, "tela")?.track;
  if (tela && tela.kind === Track.Kind.Audio) {
    somDaTela.aplicar(userId, tela as RemoteAudioTrack);
  }
}

/**
 * O som das telas que você assiste — ver `sdk/audioDaTransmissao.ts`. Um
 * contexto por sala, criado na primeira faixa e fechado na saída.
 */
const somDaTela = criarAudioDaTransmissao({
  criarContexto: () =>
    typeof AudioContext === "undefined" ? undefined : new AudioContext(),
  destino: elementoDeAudio,
  ganho: volumeEfetivoDaTransmissao,
});

const publicacoes = publicacoesDaSala(() => sala);

function participanteRemoto(userId: string): RemoteParticipant | undefined {
  return publicacoes.participante(userId);
}

function publicacaoDeVideo(
  userId: string,
  fonte: FonteDeVideo,
): RemoteTrackPublication | undefined {
  return publicacoes.video(userId, fonte);
}

/**
 * O áudio que acompanha uma tela compartilhada.
 *
 * ⚠ **Ele é uma publicação SEPARADA, e é por isso que a tela chegava muda.**
 * `getDisplayMedia` captura o som do sistema junto (ver `AUDIO_DA_TELA`) e o
 * LiveKit o publica como `ScreenShareAudio`, ao lado de `ScreenShare` — duas
 * faixas, dois `setSubscribed`. `pedirVideo` só conhecia a de vídeo, então
 * quem assistia recebia a imagem e nunca pedia o som. O defeito não estava na
 * captura nem na reprodução: o áudio era capturado, era publicado, e ninguém
 * do outro lado o assinava.
 *
 * `undefined` para câmera de propósito: microfone é outra fonte e já é
 * assinado por conta própria ao entrar na sala.
 */
function publicacaoDeAudioDaTela(
  userId: string,
  fonte: FonteDeVideo,
): RemoteTrackPublication | undefined {
  return publicacoes.audioDaTela(userId, fonte);
}

/**
 * Entra numa sala de voz.
 *
 * `joinCall` do protocolo devolve `{token, url}` — o token é do LiveKit, não do
 * Stoat, e vale para uma sala só. É a única chamada de rede desta etapa que
 * passa pelo `stoat.js`.
 */
/** O canal da sala ATUAL (não o do store, que já pode apontar para a próxima). */
let canalDaSala = "";
/** Gera-se um por entrada; sair ou trocar invalida a anterior. */
let sessao = 0;
/** Canal que está sendo entrado agora — o segundo clique no mesmo não repete. */
let entrandoEm = "";

export async function entrarNaChamada(channelId: string): Promise<boolean> {
  if (entrandoEm === channelId) return true;
  if (
    sala !== undefined &&
    canalDaSala === channelId &&
    lerChamada().estado !== "fora"
  ) {
    return true;
  }

  const minha = ++sessao;
  entrandoEm = channelId;
  const vigente = () => minha === sessao;

  /*
    ⚠ **Trocar de sala não espera o `leave_call`.** O aviso ao servidor roda
    junto com o `disconnect` e a entrada na nova começa assim que o
    `disconnect` local termina; o aviso nunca lança e tem teto de 2 s.
  */
  await desmontarSala(false);
  if (!vigente()) return false;
  limparFalhaDeVoz();
  definirChamada({ estado: "conectando", channelId, participantes: [] });

  try {
    const canal = client.channels.get(channelId);
    if (!canal) throw new Error("canal desconhecido");

    let saida: Promise<void> = Promise.resolve();
    const r = await conectarComMicrofone<Room, LocalAudioTrack>({
      /* Mudo (ou sem permissão de falar) não pede o dispositivo. */
      querMicrofone: deveTransmitir(),
      capturar: () => createLocalAudioTrack(constraintsDeAudio()),
      aindaQuerMicrofone: deveTransmitir,
      vigente,
      soltar: (faixa) => faixa.stop(),
      publicar: async (sala, faixa) => {
        await sala.localParticipant.publishTrack(faixa, {
          source: Track.Source.Microphone,
        });
      },
      publicarAgora: async (sala) => {
        await sala.localParticipant.setMicrophoneEnabled(
          true,
          constraintsDeAudio(),
        );
      },
      entrar: async () => {
        const no = await noMaisRapido();
        if (!vigente()) throw new EntradaCancelada();
        const auth = await canal.joinCall(no);
        if (!vigente()) throw new EntradaCancelada();

        const nova = new Room(opcoesDaSala(channelId));
        sala = nova;
        canalDaSala = channelId;
        ligarEventos(nova, channelId);

        /*
          `autoSubscribe: false` é o padrão daqui, e é decisão de custo: com ele
          ligado, entrar numa sala de dez pessoas começa a baixar dez faixas de
          vídeo que ninguém pediu. O áudio é assinado por evento, acima.
        */
        await nova.connect(auth.url, auth.token, { autoSubscribe: false });
        /* Em paralelo com a captura do microfone que ainda possa estar pendente. */
        saida = aplicarSaida(nova);
        return nova;
      },
    });
    /*
      ⚠ **As preferências de Voz e vídeo chegam ao WebRTC AQUI**, e são as três
      que o navegador sabe cumprir: supressão de ruído, cancelamento de eco e
      controle de ganho são `MediaTrackConstraints` (`constraintsDeAudio`,
      usadas na captura acima), mais o `deviceId` da entrada.
    */
    if (!vigente()) throw new EntradaCancelada();
    await saida;
    void aplicarRuido();
    let modo = lerPreferenciasDeVoz().modo;
    pararDeOuvirPreferencias = assinarPreferenciasDeVoz(() => {
      void trocarDispositivos(r);
      /* Os dois voltam cedo quando nada mudou: a assinatura acorda a cada
         passo do deslizante de volume, e isso não pode baixar WASM. */
      void aplicarRuido();
      void aplicarFundo();
      /* Trocar para push-to-talk com a chamada aberta fecha o microfone na
         hora, e voltar para detecção o reabre. */
      if (lerPreferenciasDeVoz().modo !== modo) {
        modo = lerPreferenciasDeVoz().modo;
        void aplicarMicrofone();
      }
      /* Desligar a preferência no meio de uma fala devolve o volume na hora. */
      revisarAtenuacao();
    });
    pararDeOuvirTecla = assinarPushToTalk(() => void aplicarMicrofone());
    /* O limiar manual — ver `portaDeVoz.ts`. Liga sempre e decide a cada
       passo se vale, para acompanhar a troca de modo com a chamada aberta. */
    pararPortaDeVoz = ligarPortaDeVoz(
      () =>
        r.localParticipant.getTrackPublication(Track.Source.Microphone)
          ?.audioTrack,
    );
    const pararVoz = assinarVolumeEfetivo(definirVolumeDe);
    const pararTela = assinarQualquerVolumeDaTransmissao(definirVolumeDe);
    pararDeOuvirVolumes = () => {
      pararVoz();
      pararTela();
    };
    entrandoEm = "";
    return true;
  } catch (e) {
    /* Superada por sair ou por outra sala: quem superou já cuidou do estado, e
       limpar aqui derrubaria a sala NOVA. */
    if (!vigente()) return false;
    /*
      ⚠ **DESCONECTA a sala, e não só limpa o store — o caminho de falha
      deixava você conectado de verdade.**

      A primeira leitura deste defeito foi errada e vale registrar: eu supus
      que `joinCall` registrava a presença no servidor e que sobrava um
      fantasma sem conserto, porque o protocolo não tem rota de saída. A fonte
      desmente — `crates/delta/src/routes/channels/voice_join.rs` só emite um
      TOKEN. Quem registra presença é o webhook do LiveKit.

      Ou seja: se você aparece na sala depois de "não deu para entrar", é
      porque `r.connect()` DEU CERTO e o que estourou foi o passo seguinte —
      abrir o microfone, por exemplo, que falha quando o navegador nega o
      dispositivo. E o `catch` largava `sala` conectada: presença real, áudio
      real, com o app se dando por fora. Medido em navegador: "1 na sala" ao
      lado do toast de falha.

      `sairDaChamada` desconecta, solta os ouvintes e limpa o store; o LiveKit
      avisa o servidor e o `VoiceChannelLeave` chega pelo caminho normal. Como
      ela volta cedo quando não houve sala, o `encerrarChamada` fica depois —
      para o caso de a falha ter sido ANTES de a sala existir.
    */
    await sairDaChamada();
    encerrarChamada();
    /*
      E a remoção local logo em seguida, para a coluna não mostrar você dentro
      da sala durante a ida e volta do webhook. É otimista como a reação: se um
      `VoiceChannelJoin` atrasado ainda estiver a caminho, o `Leave` que vem
      atrás dele corrige — o estado converge em vez de ficar mentindo.
    */
    sairDaSalaLocalmente(channelId);
    /*
      A falha vai para o STORE, e o palco a desenha (PRD 4.3: "motivo traduzido,
      e a pessoa não aparece como dentro"). Toast só quando não há palco aberto
      para mostrá-la — atender uma chamada ou entrar por atalho —, senão a
      falha seria muda.
    */
    const razao = motivo(e);
    definirFalhaDeVoz({ channelId, motivo: razao });
    if (lerPalco().tipo === "fechado") {
      toast({
        tipo: "erro",
        titulo: "Não deu para entrar na chamada.",
        descricao: razao,
      });
    }
    return false;
  }
}

/**
 * Sai.
 *
 * Avisa o servidor pela rota `leave_call` (ADR-002) EM PARALELO com o
 * `disconnect`, sem bloquear por mais de 2 s: se falhar, o webhook do LiveKit
 * continua de plano B.
 */
export async function sairDaChamada(): Promise<void> {
  /* Invalida uma entrada em andamento: ela não pode terminar de conectar
     depois que a pessoa mandou sair. */
  sessao += 1;
  entrandoEm = "";
  await desmontarSala(true);
  encerrarChamada();
}

class EntradaCancelada extends Error {}

/**
 * Desfaz a sala atual. `esperarAviso: false` (trocar de sala) volta assim que
 * o `disconnect` local termina — o `leave_call` segue em segundo plano.
 */
async function desmontarSala(esperarAviso: boolean): Promise<void> {
  const r = sala;
  /*
    O canal da SALA, e não o do store: na troca o store já pode apontar para a
    próxima sala, e o `leave_call` iria para o canal errado.
  */
  const canalId = canalDaSala;
  sala = undefined;
  canalDaSala = "";
  pararDeOuvirPreferencias?.();
  pararDeOuvirPreferencias = undefined;
  pararDeOuvirTecla?.();
  pararDeOuvirTecla = undefined;
  pararPortaDeVoz?.();
  pararPortaDeVoz = undefined;
  esquecerProcessadores();
  pararDeOuvirVolumes?.();
  pararDeOuvirVolumes = undefined;
  somDaTela.fechar();
  desligarAssinaturaDeVideo?.();
  desligarAssinaturaDeVideo = undefined;
  /* Pedidos e novas tentativas morrem com a sala, como no `Disconnected` —
     que não roda aqui, porque os ouvintes saem antes do `disconnect`. */
  assinatura.limpar();
  if (!r) return;
  r.removeAllListeners();
  /* Os ouvintes saíram antes do `disconnect`, então o `Disconnected` não
     roda: o anúncio e o que os outros anunciavam morrem aqui. */
  esquecerEspectadores();
  await encerrarSala({
    avisar: () => avisarSaidaDaSala(canalId),
    desconectar: () => r.disconnect().then(() => undefined),
    esperarAviso,
  });
  encerrarChamada();

  /*
    ⚠ **A saída limpa a CHAMADA e esquecia a SALA, e o fantasma ficava na
    coluna.** `encerrarChamada` zera o store da chamada — faixa e cartão sumem
    —, mas a lista de quem está dentro do canal de voz é outro store, e
    ninguém a tocava. Medido: dez segundos depois de sair, a coluna ainda
    mostrava `sonda_anexo · com o microfone desligado` dentro da "Sala do
    time"; só um F5 limpava.

    ⚠ **E o servidor estava certo o tempo todo** — depois de recarregar a sala
    aparecia vazia. Ou seja o webhook do LiveKit funciona e o `Ready` traz a
    verdade; o que faltava era o cliente não mentir no intervalo.

    Otimista, como a reação: se um `VoiceChannelLeave` vier atrás, ele diz a
    mesma coisa. É exatamente o que o caminho de FALHA já fazia desde que
    entrar na chamada parou de falhar calado — faltava a metade de sucesso,
    que é a que acontece todo dia.
  */
  if (canalId !== "") sairDaSalaLocalmente(canalId);
}

/**
 * Trocar de microfone ou de fone SEM sair da chamada.
 *
 * ⚠ A assinatura vive só enquanto a sala existe, e é desfeita em
 * `sairDaChamada` — listener sem cleanup é o erro nº 5 do briefing, e este
 * ficaria pendurado numa `Room` já desconectada.
 *
 * Sem `try`: `switchActiveDevice` rejeita quando o dispositivo some no meio
 * (fone desconectado), e uma exceção não tratada aqui derrubaria a chamada por
 * causa de uma troca de dispositivo.
 */
let pararDeOuvirPreferencias: (() => void) | undefined;
/** Volume individual e silêncio só para mim — ver `store/volumesDeVoz.ts`. */
let pararDeOuvirVolumes: (() => void) | undefined;
let pararDeOuvirTecla: (() => void) | undefined;
let pararPortaDeVoz: (() => void) | undefined;

/** Mudo, surdo e push-to-talk decidindo juntos — ver `microfoneAberto`. */
function deveTransmitir(): boolean {
  const c = lerChamada();
  return microfoneAberto({
    mudo: c.mudo,
    surdo: c.surdo,
    modo: lerPreferenciasDeVoz().modo,
    segurando: lerSegurando(),
  });
}

async function aplicarMicrofone(): Promise<void> {
  await sala?.localParticipant.setMicrophoneEnabled(deveTransmitir());
  /* Em push-to-talk a faixa só passa a existir no primeiro aperto. */
  void aplicarRuido();
}

/* ------------------------------------------------ processadores de mídia */

/*
  ⚠ **As duas bibliotecas pesadas NUNCA entram por aqui estaticamente.** O
  RNNoise (`voz/ruidoForte.ts`) e o segmentador (`voz/fundoDeVideo.ts`) chegam
  por `await import()`, dentro das funções abaixo, e só quando a opção está
  ligada — o fundo, só com a câmera aberta. Os `import type` do topo somem na
  compilação. Quem entra numa chamada com "Padrão" e sem fundo não baixa um
  byte de nenhum dos dois.
*/

const NOME_DO_RUIDO = "vortex-ruido-forte";

/**
 * O contexto do RNNoise, um por chamada.
 *
 * ⚠ **Nosso, e não o da `Room`.** O LiveKit só cria contexto com
 * `webAudioMix`, que está desligado aqui, e o dele nasceria na taxa do
 * hardware — 44,1 kHz em muita placa. O RNNoise exige 48 kHz; na taxa errada
 * a voz sai picotada sem erro nenhum.
 */
let contextoDeRuido: AudioContext | undefined;
/** A última tentativa falhou: não tentar de novo até a escolha mudar. */
let ruidoFalhou = false;

/**
 * O RNNoise na forma de processador do LiveKit.
 *
 * `restart` chega quando a faixa de entrada é trocada (outro microfone) e SEM
 * `audioContext` — por isso o contexto do `init` fica guardado.
 */
function processadorDeRuido(): TrackProcessor<
  Track.Kind.Audio,
  AudioProcessorOptions
> {
  let supressor: SupressorDeRuido | undefined;
  let contexto: AudioContext | undefined;
  const processador: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> = {
    name: NOME_DO_RUIDO,
    processedTrack: undefined,
    async init(opts) {
      contexto = opts.audioContext;
      const { suprimirRuido } = await import("../ui-logica/voz/ruidoForte");
      supressor = await suprimirRuido(opts.track, contexto);
      processador.processedTrack = supressor.faixa;
    },
    async restart(opts) {
      await processador.destroy();
      if (!contexto) throw new Error("processador reiniciado sem init");
      await processador.init({ ...opts, audioContext: contexto });
    },
    destroy() {
      supressor?.destruir();
      supressor = undefined;
      processador.processedTrack = undefined;
      return Promise.resolve();
    },
  };
  return processador;
}

function faixaDoMicrofone(): LocalAudioTrack | undefined {
  const t = sala?.localParticipant.getTrackPublication(
    Track.Source.Microphone,
  )?.track;
  return t instanceof LocalAudioTrack ? t : undefined;
}

/**
 * Liga ou desliga a supressão FORTE na faixa do microfone, conforme a
 * preferência. Coalescida: trocar de nível três vezes seguidas aplica a última.
 */
const aplicarRuido = coalescer(async () => {
  const faixa = faixaDoMicrofone();
  const quer = querRuidoForte(lerPreferenciasDeVoz().ruido);
  if (!quer) ruidoFalhou = false;
  if (!faixa) return;
  const tem = faixa.getProcessor()?.name === NOME_DO_RUIDO;
  if (quer === tem || (quer && ruidoFalhou)) return;

  try {
    if (!quer) {
      await faixa.stopProcessor();
      return;
    }
    contextoDeRuido ??= new AudioContext({ sampleRate: TAXA_DO_RNNOISE });
    faixa.setAudioContext(contextoDeRuido);
    await faixa.setProcessor(processadorDeRuido());
  } catch (e) {
    ruidoFalhou = true;
    /* A faixa segue com a supressão do navegador — a de "Padrão" —, e a
       pessoa continua sendo ouvida. */
    toast({
      tipo: "erro",
      titulo: "Supressão agressiva indisponível.",
      descricao: `Seguindo com a supressão padrão. ${motivo(e)}`,
    });
  }
});

/** O que está aplicado na câmera agora, e por qual processador. */
let fundoAplicado: FundoDeVideo = "nenhum";
let processadorDeFundo: BackgroundProcessorWrapper | undefined;
/** A escolha que falhou — não recarregar o modelo a cada preferência mexida. */
let fundoFalhou: FundoDeVideo | undefined;

function faixaDaCamera(): LocalVideoTrack | undefined {
  const t = sala?.localParticipant.getTrackPublication(
    Track.Source.Camera,
  )?.track;
  return t instanceof LocalVideoTrack ? t : undefined;
}

/**
 * Aplica o fundo pedido à faixa da câmera.
 *
 * ⚠ **Trocar entre desfoque e imagem NÃO recria o segmentador** — `switchTo`
 * reaproveita o modelo carregado. Só criar e remover baixam ou soltam o
 * MediaPipe. Ver `planoDeFundo`.
 */
const aplicarFundo = coalescer(async () => {
  const faixa = faixaDaCamera();
  /* A faixa trocou ou sumiu: o processador que eu conhecia não está nela. */
  if (
    !faixa ||
    (processadorDeFundo && faixa.getProcessor() !== processadorDeFundo)
  ) {
    processadorDeFundo = undefined;
    fundoAplicado = "nenhum";
  }
  const desejado = fundoEfetivo(
    lerPreferenciasDeVoz().fundo,
    lerChamada().camera,
  );
  if (desejado !== fundoFalhou) fundoFalhou = undefined;
  if (!faixa || desejado === fundoFalhou) return;

  const plano = planoDeFundo(fundoAplicado, desejado);
  try {
    if (plano === "nada") return;
    if (plano === "remover") {
      await faixa.stopProcessor();
      processadorDeFundo = undefined;
      fundoAplicado = "nenhum";
      return;
    }
    const fundo = await import("../ui-logica/voz/fundoDeVideo");
    if (plano === "trocar" && processadorDeFundo) {
      await processadorDeFundo.switchTo(fundo.opcoesDeFundo(desejado));
      fundoAplicado = desejado;
      return;
    }
    if (desejado === "nenhum") return;
    if (!fundo.suportaFundo()) {
      throw new Error("Este navegador não tem WebGL2 para segmentar o vídeo.");
    }
    const novo = fundo.criarProcessadorDeFundo(desejado);
    await faixa.setProcessor(novo);
    processadorDeFundo = novo;
    fundoAplicado = desejado;
  } catch (e) {
    fundoFalhou = desejado;
    toast({
      tipo: "erro",
      titulo: "Fundo do vídeo indisponível.",
      descricao: e instanceof Error ? e.message : "O vídeo segue sem efeito.",
    });
  }
});

/** A sala acabou; o que era dela também. As faixas morrem com o `disconnect`. */
function esquecerProcessadores(): void {
  processadorDeFundo = undefined;
  fundoAplicado = "nenhum";
  fundoFalhou = undefined;
  ruidoFalhou = false;
  void contextoDeRuido?.close();
  contextoDeRuido = undefined;
}

/**
 * Baixa os outros programas enquanto alguém fala — ver `sdk/atenuacao.ts`.
 * Sem a ponte da casca (navegador) é inerte: a web não mexe no volume de
 * outros programas.
 */
const atenuador = criarAtenuador({
  enviar: (sim) => ponteDeAtenuacao()?.atenuar(sim),
});

/** A preferência, menos o que a transmissão de som proíbe. Ver `atenuacao.ts`. */
function atenuacaoLigada(): boolean {
  return atenuacaoValeAgora({
    preferencia: lerPreferenciasDeVoz().atenuarOutrosApps,
    /* `"mudo"` não conta: a faixa existe e não sai daqui, então não há mix a
       proteger. Ver `Chamada.telaAudio`. */
    transmitindoAudio: lerChamada().telaAudio === "ligado",
  });
}

/**
 * Devolve o volume dos outros apps AGORA se a atenuação deixou de valer.
 *
 * Chamado em toda mudança de `telaAudio`: começar a transmitir com som no meio
 * de uma fala deixaria o computador a 50% dentro da própria transmissão, e o
 * caminho normal (`ActiveSpeakersChanged`) só passaria por aqui quando alguém
 * parasse de falar.
 */
function revisarAtenuacao(): void {
  if (!atenuacaoLigada()) atenuador.atualizar(false, false, true);
}

async function aplicarSaida(r: Room): Promise<void> {
  const { saidaId } = lerPreferenciasDeVoz();
  /* O som da tela toca pelo contexto próprio, que a sala não conhece. */
  await somDaTela.trocarSaida(saidaId);
  if (saidaId === undefined) return;
  try {
    await r.switchActiveDevice("audiooutput", saidaId);
  } catch {
    /* Dispositivo sumiu entre a escolha e o uso. O padrão do sistema assume. */
  }
}

async function trocarDispositivos(r: Room): Promise<void> {
  const { entradaId, cameraId } = lerPreferenciasDeVoz();
  try {
    if (entradaId !== undefined) {
      await r.switchActiveDevice("audioinput", entradaId);
    }
  } catch {
    /* Idem. */
  }
  /*
    ⚠ A câmera era escolhida em Configurações e NUNCA chegava ao LiveKit:
    `cameraId` era gravado, lido pela prévia da própria tela e ignorado aqui.
    O `▾` da doca (D-TELA-18) tornou isso visível — escolher a câmera durante
    a chamada e continuar vendo a outra. `switchActiveDevice` também grava o
    padrão de captura da sala, então ligar a câmera depois já sai na certa.
  */
  try {
    if (cameraId !== undefined) {
      await r.switchActiveDevice("videoinput", cameraId);
    }
  } catch {
    /* Idem. */
  }
  await aplicarSaida(r);
}

/**
 * A grafia do LiveKit para a nossa. Não sai daqui.
 *
 * `Unknown` e `Lost` são estados diferentes e o produto os trata igual? Não:
 * `perdida` é a única que muda a cor do painel para danger, porque é a única
 * em que a pessoa provavelmente já parou de ser ouvida.
 */
function traduzirQualidade(q: ConnectionQuality): QualidadeDeVoz {
  switch (q) {
    case ConnectionQuality.Excellent:
      return "otima";
    case ConnectionQuality.Good:
      return "boa";
    case ConnectionQuality.Poor:
      return "ruim";
    case ConnectionQuality.Lost:
      return "perdida";
    default:
      return "desconhecida";
  }
}

export async function alternarMudo(): Promise<void> {
  // A regra é do store; aqui só se APLICA no transporte. Ver
  // `alternarMudoNoStore`.
  alternarMudoNoStore();
  await aplicarMicrofone();
}

/**
 * Ensurdecer também emudece.
 *
 * Quem não está ouvindo não deve continuar falando: é a convenção de todo
 * cliente de voz, e a razão é social — falar sem ouvir a resposta atropela a
 * conversa. Desensurdecer NÃO desfaz o mudo automaticamente: se a pessoa já
 * estava muda antes, voltar a transmitir seria uma decisão que ela não tomou.
 */
export async function alternarSurdo(): Promise<void> {
  const { surdo } = alternarSurdoNoStore();
  await aplicarMicrofone();
  /*
    O estado já está no store; aqui se reaplica o ganho de quem JÁ está na
    sala. Quem chegar depois pega o mesmo valor em `TrackSubscribed`. O áudio
    de uma tela que JÁ tinha chegado não dispara esse evento de novo: a
    contabilidade chama `audioDaTelaJaPresente`.
  */
  aplicarVolumeDeTodos();
  if (surdo) pararTodos();
}

/**
 * Reaplica o ganho efetivo de todo mundo que está na sala agora.
 *
 * ⚠ **Substitui o `querySelectorAll("audio")` que morava em `alternarSurdo`, e
 * a diferença é o defeito.** Aquele laço só alcançava os elementos existentes
 * NAQUELE instante: ensurdecer e depois abrir a transmissão de alguém fazia o
 * som da tela tocar, e quem entrasse na sala depois do ensurdecer era ouvido.
 * Agora o surdo mora em `volumeEfetivo` (ver `store/volumesDeVoz.ts`), que é
 * por onde TODA faixa passa — a nova, em `TrackSubscribed`, a que já estava
 * anexada, aqui, e a de tela que chegou antes do pedido, em
 * `audioDaTelaJaPresente`.
 */
function aplicarVolumeDeTodos(): void {
  for (const p of sala?.remoteParticipants.values() ?? []) {
    definirVolumeDe(p.identity);
  }
}

/**
 * O participante local, ou a notícia de que não há sala.
 *
 * ⚠ **Existe por causa de um defeito silencioso, e ele é a razão desta função
 * não ser um `sala?.` a mais.** Câmera e tela eram `await
 * sala?.localParticipant.setXEnabled(v)` — e com `sala` indefinida o
 * encadeamento opcional devolve `undefined`, `await undefined` RESOLVE, o
 * `catch` nunca dispara e a linha seguinte marca o estado como ligado.
 *
 * O sintoma medido: clicar em "Compartilhar tela" levava `aria-pressed` de
 * `false` para `true` nos dois botões, **sem abrir seletor nenhum e sem erro
 * no console**. A interface afirmava estar transmitindo com nada acontecendo —
 * que é a única coisa que ela existe para não fazer.
 *
 * ⚠ **Mudo e surdo continuam com `sala?.` de propósito**, e a diferença é
 * real: aqueles são PREFERÊNCIA, aplicada no store antes de tocar o
 * transporte, e valem fora da chamada (ver `alternarMudoNoStore`). Câmera e
 * tela são transporte puro — sem sala não há o que ligar.
 */
function participanteLocal(): LocalParticipant | undefined {
  const p = sala?.localParticipant;
  if (!p) {
    toast({
      tipo: "erro",
      titulo: "A chamada não está conectada.",
      descricao: "Entre numa sala de voz para transmitir.",
    });
  }
  return p;
}

export async function alternarCamera(): Promise<void> {
  const p = participanteLocal();
  if (!p) return;

  const camera = !lerChamada().camera;
  try {
    await p.setCameraEnabled(camera);
    definirChamada({ camera });
    /* Depois do store: `fundoEfetivo` lê a câmera dele. */
    void aplicarFundo();
    publicarVideoLocal(p, "camera", Track.Source.Camera, camera);
  } catch {
    // Permissão negada é o caso comum, e não é erro do app.
    toast({
      tipo: "erro",
      titulo: "Câmera indisponível.",
      descricao: "Verifique a permissão do navegador.",
    });
  }
}

/**
 * Captura de áudio da TELA, não de microfone.
 *
 * LiveKit defaulta `audio` para `false` em `getDisplayMedia`. Sem isto a
 * caixa "compartilhar áudio da aba" nem aparece. E se aparecesse com os
 * defaults de mic (AEC/AGC/NS), o som do sistema seria tratado como eco e
 * sumiria. `restrictOwnAudio` evita recapturar o que você já está ouvindo.
 */
const AUDIO_DA_TELA = {
  autoGainControl: false,
  echoCancellation: false,
  noiseSuppression: false,
  voiceIsolation: false,
  restrictOwnAudio: true,
} as const;

function comAudioDaTela(
  opcoes: ScreenShareCaptureOptions,
): ScreenShareCaptureOptions {
  if (opcoes.audio === false) return opcoes;
  return {
    ...opcoes,
    audio: typeof opcoes.audio === "object" ? opcoes.audio : AUDIO_DA_TELA,
    systemAudio: opcoes.systemAudio ?? "include",
  };
}

/** A captura de som da janela em curso, com o que precisa ser desfeito. */
let audioDeJanelaEmCurso: { parar: () => void } | undefined;

/**
 * Publica o som de UMA janela, capturado pela casca por processo.
 *
 * ⚠ **Falhar aqui não derruba a transmissão.** O vídeo já está no ar; sem o
 * som, ela segue muda e um toast diz por quê. Voltar ao som do sistema seria
 * o defeito que isto existe para evitar.
 */
async function publicarAudioDaJanela(p: LocalParticipant): Promise<void> {
  pararAudioDaJanela();
  const ponte = ponteDeAudioDeJanela();
  const pcm = criarFaixaDePcm();
  if (!ponte || !pcm) return;

  const soltar = ponte.assinar(pcm.escrever);
  const parar = () => {
    soltar();
    pcm.fechar();
    void ponte.parar().catch(() => undefined);
  };

  const iniciou = await ponte.iniciar().catch(() => false);
  if (!iniciou) {
    parar();
    toast({
      tipo: "info",
      titulo: "A janela está sendo transmitida sem som.",
      descricao:
        "Não deu para capturar o áudio só desta janela. Requer Windows 10 2004 ou mais novo.",
    });
    return;
  }

  audioDeJanelaEmCurso = { parar };
  try {
    await p.publishTrack(pcm.faixa, {
      source: Track.Source.ScreenShareAudio,
      /* Som de janela é música, vídeo ou jogo — não voz. Sem DTX, que corta o
         que parece silêncio, e em estéreo. */
      audioPreset: AudioPresets.musicHighQualityStereo,
      dtx: false,
      red: false,
      forceStereo: true,
    });
  } catch (e) {
    pararAudioDaJanela();
    toast({
      tipo: "erro",
      titulo: "Não deu para enviar o som da janela.",
      descricao: motivo(e),
    });
  }
}

async function publicarAudioDoMixer(p: LocalParticipant): Promise<void> {
  const ponte = ponteDoMixer();
  const pcm = criarFaixaDePcm();
  if (!ponte || !pcm) return;
  const soltar = ponte.assinar(pcm.escrever);
  const parar = () => {
    soltar();
    pcm.fechar();
    void ponte.parar().catch(() => undefined);
  };
  const iniciou = await ponte.iniciar().catch(() => false);
  if (!iniciou) {
    parar();
    toast({
      tipo: "info",
      titulo: "A tela está sendo transmitida sem o som dos apps.",
      descricao: "Não deu para capturar as faixas marcadas.",
    });
    return;
  }
  audioDeJanelaEmCurso = { parar };
  try {
    await p.publishTrack(pcm.faixa, {
      source: Track.Source.ScreenShareAudio,
      audioPreset: AudioPresets.musicHighQualityStereo,
      dtx: false,
      red: false,
      forceStereo: true,
    });
  } catch (e) {
    parar();
    audioDeJanelaEmCurso = undefined;
    toast({
      tipo: "erro",
      titulo: "Não deu para enviar o som da tela.",
      descricao: motivo(e),
    });
  }
}

function pararAudioDaJanela(): void {
  audioDeJanelaEmCurso?.parar();
  audioDeJanelaEmCurso = undefined;
}

/**
 * Compartilhar a tela.
 *
 * ⚠ **Quem desenha o seletor é o NAVEGADOR**, não o Vortex.
 * `setScreenShareEnabled(true)` chama `getDisplayMedia`, e a escolha de tela,
 * janela ou aba é uma superfície do sistema — nenhuma página pode substituí-la
 * nem estilizá-la. O seletor próprio que o design desenha (Telas · Janelas ·
 * Abas, com resolução e taxa de quadros) só é possível na casca Electron, via
 * `desktopCapturer`, e é trabalho de outra etapa.
 *
 * ⚠ `getDisplayMedia` exige ativação transitória — o clique. O caminho aqui
 * passa por um `await import()` do motor, mas na chamada REAL o módulo já foi
 * carregado por `entrarNaChamada`, então o clique chega direto. É só no arnês,
 * onde a chamada é falsa e o motor nunca foi carregado, que o import acontece
 * no clique.
 */
export async function alternarTela(): Promise<void> {
  const p = participanteLocal();
  if (!p) return;

  const ligando = !lerChamada().tela;

  /* Desligar não escolhe nada — o seletor só existe no caminho de ligar. */
  if (!ligando) {
    try {
      await p.setScreenShareEnabled(false);
    } finally {
      definirChamada({ tela: false, telaPausada: false, telaAudio: "sem" });
      publicarVideoLocal(p, "tela", Track.Source.ScreenShare, false);
      /* Mesma correção do handler de `LocalTrackUnpublished`: a sala é o
         conteúdo do canal, então parar de transmitir volta para a grade em
         vez de sair dela. */
      if (lerPalco().tipo === "transmitindo") definirPalco({ tipo: "grade" });
    }
    return;
  }

  /*
    Na casca, o Vortex escolhe; no navegador, o sistema.

    `seletorProprio()` é a pergunta certa em vez de "estamos no Electron":
    mesmo dentro da casca, Wayland e macOS recente desenham o seletor do
    sistema e o handler nem roda. Quem sabe disso é a casca.
  */
  const ponte = ponteDeTela();
  const proprio = ponte !== undefined && (await ponte.seletorProprio());

  /*
    ⚠ **O painel do Vortex abre nos DOIS caminhos, e só na casca ele lista
    fontes.** No navegador o ◧ ia direto ao `getDisplayMedia`, então áudio e
    qualidade não eram escolhíveis e o motivo de um toggle indisponível nunca
    chegava à tela. Agora o painel decide o que é do app e "Transmitir" chama o
    sistema — que é quem mostra telas, janelas e abas.

    ⚠ O `getDisplayMedia` continua dentro da ativação do clique: o clique em
    "Transmitir" resolve a promessa, e o caminho até a captura é de
    microtarefas, sem `setTimeout` nem rede no meio.
  */
  try {
    await transmitir(p, ponte, proprio);
  } finally {
    /* O modal fica em "Iniciando" até aqui: no ar, falhou ou cancelou. */
    concluirEscolhaDeTela();
  }
}

async function transmitir(
  p: LocalParticipant,
  ponte: ReturnType<typeof ponteDeTela>,
  proprio: boolean,
): Promise<void> {
  const escolha =
    ponte && proprio
      ? await comSeletorProprio(ponte)
      : await comSeletorDoSistema();

  /* `undefined` = cancelou no painel. Cancelar não é falha. */
  if (escolha === undefined) return;

  try {
    await p.setScreenShareEnabled(
      true,
      comAudioDaTela(escolha.opcoes),
      publicacaoDe(escolha.qualidade),
    );
    /*
      ⚠ **Não reaplicar constraints numa captura que já nasceu com taxa.**
      `getDisplayMedia` já recebeu o `frameRate` (ver `capturaDe`). Um
      `applyConstraints` logo em seguida reinicia o capturador do Chrome, e a
      transmissão — pior na primeira, com o capturador frio — passa a entregar
      quase nenhum quadro, em qualquer qualidade pedida. Trocar no HUD continua
      aplicando: aí a faixa já está no ar e a pessoa pediu a troca.

      "Fonte" é a exceção. Sem `resolution` o LiveKit injeta 1080p30 e descarta
      a taxa, então ela só existe neste `applyConstraints`. Falhar não derruba
      a transmissão — ela segue no que o navegador negociou.
    */
    if (ALTURA_DE[escolha.qualidade.resolucao] === undefined) {
      await faixaDeTela()
        ?.applyConstraints(constraintsDe(escolha.qualidade))
        .catch(() => undefined);
    }
    definirQualidadeEscolhida(escolha.qualidade);
    /* Antes de ler `telaAudio` abaixo: é esta publicação que decide se há som. */
    if (escolha.audioDeJanela) await publicarAudioDaJanela(p);
    if (escolha.audioMixado) await publicarAudioDoMixer(p);
    definirChamada({
      tela: true,
      telaPausada: false,
      /* A faixa de áudio só existe quando a pessoa marcou a caixa no seletor
         do sistema — e nem toda plataforma oferece a caixa. Perguntar é a
         única forma de saber; supor produziria um "silenciado" para quem
         nunca teve som nenhum. */
      telaAudio:
        p.getTrackPublication(Track.Source.ScreenShareAudio) === undefined
          ? "sem"
          : "ligado",
    });
    /* Depois do store, porque ele é quem responde se há som no ar: transmitir
       som e atenuar outros apps se contradizem — ver `atenuacaoValeAgora`. */
    revisarAtenuacao();
    /*
      ⚠ **A faixa local de TELA no store, e ela NUNCA esteve lá.**

      `publicarVideoLocal` era chamado só para a câmera, então
      `faixasDeVideo` conhecia a sua webcam e não o seu compartilhamento. Todo
      consumidor que lê o store — o ladrilho da grade e o palco do popout —
      procurava `chaveDeVideo(voce, "tela")` e não achava nada, exibindo o
      xadrez de "ainda não chegou" para uma faixa que estava publicada e
      rodando. Sem erro nenhum: `undefined` é o mesmo valor de "esta pessoa
      não está transmitindo".

      A prancha escapava porque tem um caminho PRÓPRIO (`faixaDeTela()`, um
      getter direto no `localParticipant`) — e é exatamente o segundo caminho
      que o comentário de `publicarVideoLocal` diz existir para evitar. Ele
      mascarou a ausência: a única tela onde a própria transmissão aparecia
      era a única que não usava o store.

      Relatado por quem usa, transmitindo de verdade: "a tela não aparece ali
      na popup".
    */
    publicarVideoLocal(p, "tela", Track.Source.ScreenShare, true);
    /*
      ⚠ **A SALA, e nao a prancha de transmissao.** Comecar a transmitir abria
      `PalcoDeTransmissao` em cima do app inteiro — quem usa relatou a tela
      cheia de HUD com rail, canais e membros desaparecidos, e nenhuma forma de
      voltar sem parar de transmitir.

      O sintoma original que este `definirPalco` resolve continua resolvido: a
      sala mostra a sua tela como PREVIA num ladrilho, com o selo de ao vivo e
      o botao de parar. O que se perdeu foi so a tomada de conta — a prancha
      continua a um clique, pelo ladrilho, para quem quiser o HUD inteiro.
    */
    definirPalco({ tipo: "grade" });
  } catch (e) {
    definirChamada({ tela: false, telaPausada: false, telaAudio: "sem" });
    void ponte?.cancelar();

    /*
      ⚠ **O `catch` engolia TUDO, e com isso falha real e desistência ficavam
      indistinguíveis — para quem usa e para quem depura.**

      A justificativa antiga era verdadeira pela metade: cancelar o seletor do
      sistema de fato cai aqui, e avisar sobre isso seria ruído sobre uma
      decisão que a pessoa acabou de tomar. Mas o mesmo `catch` também pega o
      LiveKit falhando ao PUBLICAR a faixa depois de a captura ter dado certo,
      o codec recusado, e a chamada tendo caído no meio — e nesses o botão
      voltava ao repouso sem uma palavra.

      Medido no painel do navegador, que bloqueia captura: clicar em
      "Compartilhamento de tela" não fazia absolutamente nada. Sem toast, sem
      console, com `aria-pressed` de volta em `false`.

      ⚠ **`NotAllowedError` continua calado, e não é preguiça: o padrão
      conflaciona os dois casos.** Medido — desistir no seletor e ser barrado
      por Permissions Policy produzem o MESMO `DOMException` com o MESMO nome
      e a mensagem "Permission denied". Inventar a diferença seria afirmar na
      tela algo que o navegador não disse, que é o que a faixa de voz recusou
      ao não derivar milissegundos de uma classificação.
    */
    if (e instanceof DOMException && e.name === "NotAllowedError") return;

    toast({
      tipo: "erro",
      titulo: "Não deu para compartilhar a tela.",
      descricao: motivo(e),
    });
  }
}

/**
 * A faixa de vídeo da transmissão, para a prévia local.
 *
 * ⚠ **SÍNCRONA e devolvendo `MediaStreamTrack` cru, e as duas coisas são
 * decisão.** Síncrona porque quem a chama é um efeito de componente, e um
 * `await` ali significaria um render com a caixa vazia antes de cada quadro.
 * Crua porque nada de `livekit-client` sai deste arquivo — a mesma regra que
 * mantém `Room` aqui dentro. O componente recebe um tipo do navegador e não
 * sabe que existe LiveKit.
 */
/**
 * Poe (ou tira) a PROPRIA faixa no mesmo store das alheias.
 *
 * ⚠ **O store guarda "o que um `<video>` precisa", e nao "o que o servidor
 * mandou".** A primeira versao tratava a propria camera como caso especial, com
 * um componente proprio lendo a faixa por `setTimeout` — e isso era um segundo
 * caminho para a mesma coisa, com a propria latencia e o proprio bug. Com uma
 * fonte so, o ladrilho da grade nao sabe de quem e o video.
 *
 * ⚠ **`setCameraEnabled` resolve antes de a publicacao existir em alguns
 * navegadores**, e por isso ha uma segunda tentativa. Sem ela o proprio
 * ladrilho ficaria no avatar ate o proximo render — a mesma armadilha da
 * previa da transmissao medindo 0×0.
 */
/**
 * O que VOCÊ está publicando de fato, relido do LiveKit.
 *
 * Pergunta à publicação em vez de acreditar no store — é o mesmo princípio de
 * `publicarFontes`, que relê os remotos em vez de somar e subtrair. Reconexão
 * é justamente quando o incremental diverge.
 */
function rescanearFontesLocais(p: LocalParticipant): void {
  const camera = p.getTrackPublication(Track.Source.Camera) !== undefined;
  const tela = p.getTrackPublication(Track.Source.ScreenShare) !== undefined;

  definirChamada({ camera, tela });
  publicarVideoLocal(p, "camera", Track.Source.Camera, camera);
  publicarVideoLocal(p, "tela", Track.Source.ScreenShare, tela);
}

function publicarVideoLocal(
  p: LocalParticipant,
  fonte: FonteDeVideo,
  origem: Track.Source,
  ligado: boolean,
): void {
  const chave = chaveDeVideo(p.identity, fonte);
  if (!ligado) {
    faixasDeVideo.apagar(chave);
    return;
  }

  const por = () => {
    const faixa = p.getTrackPublication(origem)?.track?.mediaStreamTrack;
    if (faixa) faixasDeVideo.set(chave, faixa);
    return faixa !== undefined;
  };
  if (!por()) setTimeout(por, 600);
}

/**
 * O que a transmissão está REALMENTE entregando.
 *
 * ⚠ **Medido no `RTCStatsReport`, e não derivado do que se pediu.** O design
 * desenha "1080p · 30 fps · 4.2 Mbps" e, ao lado, "△ rede caiu para 22 fps" —
 * as duas frases só fazem sentido juntas se a segunda puder DESMENTIR a
 * primeira. Mostrar a taxa pedida nos dois lugares daria um aviso que nunca
 * acende, que é pior que não ter aviso.
 *
 * É a mesma recusa que impediu a faixa de voz de derivar "42 ms" de uma
 * classificação — com a diferença de que aqui o número existe.
 *
 * ⚠ **A banda é DELTA entre duas amostras**, e por isso a primeira chamada
 * devolve `kbps: undefined`: `bytesSent` é um acumulador desde o início da
 * conexão, e dividi-lo pelo tempo total daria a média da sessão inteira em vez
 * do que está saindo agora. Quem chama sabe pedir de novo.
 */
type AmostraDeTela = { bytes: number; em: number };
let amostraAnterior: AmostraDeTela | undefined;

export async function estatisticasDaTela(): Promise<
  { fps: number | undefined; kbps: number | undefined } | undefined
> {
  const faixa = sala?.localParticipant.getTrackPublication(
    Track.Source.ScreenShare,
  )?.track;
  if (!faixa) {
    amostraAnterior = undefined;
    return undefined;
  }

  const relatorio = await faixa.getRTCStatsReport();
  if (!relatorio) return undefined;

  let fps: number | undefined;
  let bytes: number | undefined;

  relatorio.forEach((entrada: unknown) => {
    const e = entrada as {
      type?: string;
      kind?: string;
      framesPerSecond?: number;
      bytesSent?: number;
    };
    if (e.type !== "outbound-rtp" || e.kind !== "video") return;
    /*
      Com simulcast há uma entrada por camada. Somar os bytes é o certo — é
      tudo o que sai desta máquina —, e para os quadros vale a MAIOR: a camada
      de menor resolução costuma andar mais devagar, e a média entre elas não
      descreve nada que alguém esteja vendo.
    */
    if (e.framesPerSecond !== undefined) {
      fps = Math.max(fps ?? 0, e.framesPerSecond);
    }
    if (e.bytesSent !== undefined) bytes = (bytes ?? 0) + e.bytesSent;
  });

  let kbps: number | undefined;
  const agora = Date.now();
  if (bytes !== undefined) {
    const anterior = amostraAnterior;
    if (anterior && agora > anterior.em && bytes >= anterior.bytes) {
      const segundos = (agora - anterior.em) / 1000;
      kbps = Math.round(((bytes - anterior.bytes) * 8) / segundos / 1000);
    }
    amostraAnterior = { bytes, em: agora };
  }

  return { fps: fps === undefined ? undefined : Math.round(fps), kbps };
}

export function faixaDeTela(): MediaStreamTrack | undefined {
  const pub = sala?.localParticipant.getTrackPublication(
    Track.Source.ScreenShare,
  );
  return pub?.track?.mediaStreamTrack;
}

/**
 * Pausa ou retoma a transmissão.
 *
 * ⚠ **`mute()` da faixa, e não `setScreenShareEnabled(false)`.** O segundo
 * DESPUBLICA: quem assiste perde a caixa, e voltar exigiria escolher a fonte
 * outra vez, com o seletor do sistema abrindo de novo. `mute` congela a
 * imagem no último quadro e mantém o lugar — que é o que "pausar" promete.
 */
export async function pausarTela(pausar: boolean): Promise<void> {
  const faixa = sala?.localParticipant.getTrackPublication(
    Track.Source.ScreenShare,
  )?.track;
  if (!faixa) return;

  if (pausar) await faixa.mute();
  else await faixa.unmute();
  definirChamada({ telaPausada: pausar });
}

/**
 * Liga e desliga o áudio que acompanha a tela.
 *
 * Sem faixa de áudio não há o que alternar — e o controle na tela precisa
 * saber disso para se desabilitar em vez de fingir. Ver `Chamada.telaAudio`.
 */
export async function alternarAudioDaTela(): Promise<void> {
  const pub = sala?.localParticipant.getTrackPublication(
    Track.Source.ScreenShareAudio,
  );
  const faixa = pub?.track;
  if (!faixa) return;

  const ligando = faixa.isMuted;
  if (ligando) await faixa.unmute();
  else await faixa.mute();
  definirChamada({ telaAudio: ligando ? "ligado" : "mudo" });
  revisarAtenuacao();
}

/**
 * Troca a fonte sem sair do ar mais do que o necessário.
 *
 * ⚠ **Para e recomeça, e não há caminho melhor.** Nem `getDisplayMedia` nem o
 * LiveKit permitem trocar a fonte de uma faixa publicada; o que existe é
 * capturar outra e substituir. Fazer isso em dois passos explícitos deixa o
 * intervalo visível para quem assiste — melhor que um controle que promete
 * troca contínua e entrega o mesmo corte.
 */
export async function trocarFonteDaTela(): Promise<void> {
  if (!lerChamada().tela) return;
  await alternarTela();
  await alternarTela();
}

/**
 * Pergunta áudio e qualidade; a FONTE quem escolhe é o sistema.
 *
 * ⚠ **Áudio desligado vira `audio: false` explícito.** `comAudioDaTela` só
 * preenche quando o campo não é `false`, e sem isto a caixa de áudio do
 * seletor do sistema apareceria marcada para quem acabou de dizer que não.
 */
async function comSeletorDoSistema(): Promise<
  | {
      opcoes: ScreenShareCaptureOptions;
      qualidade: QualidadeDaTela;
      audioDeJanela: boolean;
      audioMixado: boolean;
    }
  | undefined
> {
  const escolha = await pedirEscolhaDeTela("sistema");
  if (!escolha) return undefined;

  const qualidade: QualidadeDaTela = {
    resolucao: escolha.resolucao,
    taxa: escolha.taxa,
  };
  return {
    opcoes: {
      ...capturaDe(qualidade),
      ...(escolha.audio ? {} : { audio: false }),
    },
    qualidade,
    audioDeJanela: false,
    audioMixado: false,
  };
}

/**
 * Pergunta o que transmitir e ARMA a escolha na casca.
 *
 * Devolve as constraints para o LiveKit, ou `undefined` se a pessoa cancelou.
 *
 * ⚠ **A ordem importa: armar ANTES de pedir a captura.** O handler do main
 * consome a escolha armada quando o `getDisplayMedia` chega, e a escolha é de
 * uso único. Invertido, o pedido chegaria sem escolha e seria recusado.
 */
async function comSeletorProprio(
  ponte: NonNullable<ReturnType<typeof ponteDeTela>>,
): Promise<
  | {
      opcoes: ScreenShareCaptureOptions;
      qualidade: QualidadeDaTela;
      /** O som vem da captura por processo da casca, e não do `getDisplayMedia`. */
      audioDeJanela: boolean;
      audioMixado: boolean;
    }
  | undefined
> {
  const escolha = await pedirEscolhaDeTela("casca");
  /* Sem fonte não há o que armar: na casca a fonte é sempre escolhida no
     painel, e `undefined` aqui só viria de um pedido do modo errado. */
  if (!escolha?.fonteId) return undefined;

  /*
    ⚠ **Janela com som não pede áudio ao `getDisplayMedia`.** O único áudio
    que ele sabe entregar é o do sistema inteiro — o defeito relatado. O som da
    janela vem da captura por processo, pedida depois de o vídeo estar no ar
    (`publicarAudioDaJanela`). Casca sem essa ponte transmite a janela sem som:
    ela também já não entrega loopback para janela.
  */
  const audioDeJanela =
    escolha.audio &&
    ehJanela(escolha.fonteId) &&
    ponteDeAudioDeJanela() !== undefined;
  const audioMixado =
    escolha.audio &&
    !ehJanela(escolha.fonteId) &&
    (escolha.excluir?.length ?? 0) > 0 &&
    ponteDoMixer() !== undefined;
  const audioDoSistema =
    escolha.audio && !ehJanela(escolha.fonteId) && !audioMixado;

  const armou = await ponte.escolher(escolha.fonteId, audioDoSistema);
  if (!armou) {
    toast({
      tipo: "erro",
      titulo: "Não deu para preparar a transmissão.",
      descricao: "Tente escolher a tela de novo.",
    });
    return undefined;
  }

  const qualidade: QualidadeDaTela = {
    resolucao: escolha.resolucao,
    taxa: escolha.taxa,
  };
  return {
    opcoes: {
      ...capturaDe(qualidade),
      audio: audioDoSistema ? AUDIO_DA_TELA : false,
    },
    qualidade,
    audioDeJanela,
    audioMixado,
  };
}

/**
 * O que pedir à CAPTURA para uma qualidade.
 *
 * ⚠ Só a ALTURA vira teto — ver `ALTURA_DE`. A largura sai de `16/9` porque
 * `resolution` do LiveKit pede as duas, e travar a largura REAL da fonte
 * distorceria uma tela ultrawide. "Fonte" não põe teto: só a taxa.
 *
 * `contentHint` muda o que o codec preserva quando falta banda: `detail`
 * segura o texto e sacrifica movimento; `motion` faz o contrário.
 */
function capturaDe(q: QualidadeDaTela): ScreenShareCaptureOptions {
  const altura = ALTURA_DE[q.resolucao];
  const contentHint = pedeMovimento(q) ? "motion" : "detail";
  /*
    ⚠ **"Fonte" não passa `resolution`.** O LiveKit trata largura ou altura zero
    como "sem teto" e descarta o objeto INTEIRO — a taxa junto. A taxa dela é
    pedida logo depois de publicar, por `applyConstraints` (ver `alternarTela`).
  */
  if (altura === undefined) return { contentHint };
  return {
    resolution: {
      width: Math.round((altura * 16) / 9),
      height: altura,
      frameRate: q.taxa,
    },
    contentHint,
  };
}

/**
 * O que pedir ao CODIFICADOR ao publicar.
 *
 * ⚠ **A trava que segurava a tela em 15 fps.** Sem `screenShareEncoding` o
 * LiveKit usa `ScreenSharePresets.h1080fps15` — `maxFramerate: 15` e 2,5 Mbps
 * —, e nenhuma captura passava disso para quem assiste. A escolha agora abre
 * as duas travas juntas.
 */
function publicacaoDe(q: QualidadeDaTela): TrackPublishOptions {
  return {
    screenShareEncoding: codificacaoDe(q),
    degradationPreference: pedeMovimento(q)
      ? "maintain-framerate"
      : "maintain-resolution",
    /*
      ⚠ **Uma camada, um codec.** O padrão do LiveKit é `simulcast: true`: a
      tela sai na resolução pedida E numa cópia pela metade, na mesma taxa.
      O Chrome codifica as duas o tempo todo — e no Firefox a camada de baixo
      frequentemente não manda quadro nenhum. Trocar taxa ou resolução não
      desliga a segunda, e é por isso que toda qualidade travava igual, pior
      na primeira, com os dois codificadores frios.

      `backupCodec: false` fecha o outro caminho: o padrão `true` publica um
      segundo codec quando o primário não é VP8 e, no ato, liga `dynacast` na
      sala. Camada sem assinante fica pausada — a primeira transmissão congela
      até alguém assistir. VP8 é o codec que não cai no teto de ~5 fps do
      `L1T3` (o que o LiveKit força em tela com VP9/AV1). Se o servidor não
      oferece VP8, o próprio LiveKit cai para o primeiro codec da lista.

      Quem assiste deixa de escolher camada espacial: a miniatura e o PiP
      baixam a mesma faixa do foco. "Só áudio" continua cortando o vídeo.
    */
    simulcast: false,
    backupCodec: false,
    videoCodec: "vp8",
  };
}

/** O estado bruto da conexão, para o arnês conferir sem abrir a sala. */
export function estadoBruto(): string {
  return sala?.state ?? ConnectionState.Disconnected;
}

/**
 * O RTT da conexão de voz, do `RTCStatsReport`.
 *
 * ⚠ **Medido e nunca derivado.** `ConnectionQuality` do LiveKit é
 * CLASSIFICAÇÃO (`excellent/good/poor/lost`), e a faixa de voz já recusou
 * transformá-la em "42 ms" — dado falso numa superfície onde alguém decide se
 * troca de rede. `currentRoundTripTime` existe de verdade no par de
 * candidatos, e é ele ou `undefined`.
 *
 * ⚠ **Só o par NOMINADO.** Um `RTCPeerConnection` guarda o histórico de todos
 * os pares testados durante o ICE, inclusive os que perderam; ler qualquer um
 * daria o RTT de um caminho que não está sendo usado.
 */
export async function estatisticasDeVoz(): Promise<number | undefined> {
  const engine = (
    sala as unknown as {
      engine?: {
        pcManager?: {
          publisher?: { getStats?: () => Promise<RTCStatsReport> };
        };
      };
    }
  )?.engine;
  const obter = engine?.pcManager?.publisher?.getStats;
  if (!obter) return undefined;

  let relatorio: RTCStatsReport;
  try {
    relatorio = await obter.call(engine.pcManager?.publisher);
  } catch {
    /* A conexão pode fechar entre a decisão de medir e a medição. Sem chamada
       não há RTT, e isso não é erro. */
    return undefined;
  }

  let ms: number | undefined;
  relatorio.forEach((entrada: unknown) => {
    const e = entrada as {
      type?: string;
      nominated?: boolean;
      state?: string;
      currentRoundTripTime?: number;
    };
    if (e.type !== "candidate-pair") return;
    if (e.nominated !== true && e.state !== "succeeded") return;
    if (e.currentRoundTripTime === undefined) return;
    ms = Math.round(e.currentRoundTripTime * 1000);
  });
  return ms;
}

/**
 * Troca resolução e taxa de quadros SEM parar de transmitir.
 *
 * ⚠ **`applyConstraints` na faixa, e NÃO `restartTrack` nem republicar.** O
 * `depende` desta pendência dizia que trocar hoje era "parar e recomeçar", e a
 * afirmação estava certa sobre `setScreenShareEnabled` — que só lê as
 * constraints na PUBLICAÇÃO — e errada sobre o resto. Duas alternativas foram
 * lidas no código do SDK antes desta:
 *
 * - `LocalVideoTrack.restartTrack()` existe e serve para CÂMERA: ele chama
 *   `restart()`, que refaz a captura por `getUserMedia`. Numa faixa de tela
 *   isso pediria a câmera no lugar do que está sendo transmitido.
 * - Republicar mostraria de novo o seletor de janela do navegador, e a pessoa
 *   teria de reescolher o que já estava compartilhando.
 *
 * `applyConstraints` age sobre o `MediaStreamTrack` que já está no ar: mesma
 * faixa, mesma publicação, mesmos assinantes, sem renegociação e sem prompt.
 *
 * ⚠ **`ideal` e nunca `exact`.** Com `exact`, uma tela de 1366×768 recusaria
 * 1080p com `OverconstrainedError` — e o erro chegaria como "não deu para
 * trocar" numa escolha que o navegador teria atendido em 768p de bom grado. O
 * teto é um pedido; quem decide o que a fonte entrega é o sistema.
 */
export async function definirQualidadeDaTela(
  q: QualidadeDaTela,
): Promise<boolean> {
  const local = sala?.localParticipant.getTrackPublication(
    Track.Source.ScreenShare,
  )?.videoTrack;
  const faixa = local?.mediaStreamTrack;
  if (!local || !faixa) return false;

  try {
    faixa.contentHint = pedeMovimento(q) ? "motion" : "detail";
    await faixa.applyConstraints(constraintsDe(q));
    /* Em sequência: os dois chamam `setParameters`, e um segundo pedido com
       o `transactionId` velho é recusado com `InvalidModificationError`. */
    await local.setDegradationPreference(
      pedeMovimento(q) ? "maintain-framerate" : "maintain-resolution",
    );
    await aplicarCodificacao(local.sender, q);
    return true;
  } catch {
    /* A faixa pode ter terminado entre a escolha e a aplicação — parar de
       compartilhar pela barra do navegador faz exatamente isso. Sem
       transmissão não há qualidade a trocar, e isso não é erro. */
    return false;
  }
}

/**
 * Reabre a trava do CODIFICADOR sem renegociar.
 *
 * ⚠ **`applyConstraints` sozinho não mudava nada para quem assiste.** Ele age
 * na captura; o `maxFramerate` e o `maxBitrate` fixados na publicação
 * continuavam valendo, e subir de 30 para 60 fps entregava 30. `setParameters`
 * troca os dois na mesma conexão.
 *
 * Só a camada de MAIOR resolução recebe a escolha: com simulcast, as de baixo
 * são o que quem está em rede fraca recebe, e subir o teto delas desfaria o
 * propósito de existirem.
 */
async function aplicarCodificacao(
  sender: RTCRtpSender | undefined,
  q: QualidadeDaTela,
): Promise<void> {
  if (!sender) return;
  const parametros = sender.getParameters();
  const camadas = parametros.encodings;

  let topo = camadas[0];
  if (!topo) return;
  for (const c of camadas) {
    if ((c.scaleResolutionDownBy ?? 1) < (topo.scaleResolutionDownBy ?? 1)) {
      topo = c;
    }
  }
  const { maxBitrate, maxFramerate } = codificacaoDe(q);
  topo.maxBitrate = maxBitrate;
  topo.maxFramerate = maxFramerate;
  await sender.setParameters(parametros);
}

/**
 * O que a faixa está entregando AGORA, medido — nunca o que foi pedido.
 *
 * ⚠ `getSettings()` e não a constraint guardada: a fonte decide. Pedir 1080p
 * de uma janela de 900px devolve 900, e mostrar "1080p" ali seria a mesma
 * mentira do "Conectado · 42 ms" que a faixa de voz recusou.
 */
export function qualidadeRealDaTela():
  | { altura: number; fps: number }
  | undefined {
  const s = faixaDeTela()?.getSettings();
  if (!s?.height) return undefined;
  return { altura: s.height, fps: Math.round(s.frameRate ?? 0) };
}
