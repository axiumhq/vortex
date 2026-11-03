import { useEffect, useRef } from "react";

import { anexarVideo } from "nucleo/lib/anexarVideo";

import css from "./Palco.module.css";

/**
 * Um `<video>` preso a uma `MediaStreamTrack`. Sempre `muted`: o som da sala
 * chega pelos elementos de áudio do motor, e um segundo caminho de áudio aqui
 * dobraria cada voz.
 *
 * A MESMA faixa pode estar em vários `<video>` ao mesmo tempo (foco e
 * miniatura); anexar não reassina nada.
 */
export function VideoDaFaixa({ faixa, rotulo }: { faixa: MediaStreamTrack; rotulo: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return anexarVideo(el, faixa);
  }, [faixa]);
  return <video ref={ref} className={css.video} autoPlay muted playsInline aria-label={rotulo} />;
}
