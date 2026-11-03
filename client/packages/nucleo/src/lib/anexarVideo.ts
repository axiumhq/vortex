/**
 * Prende uma `MediaStreamTrack` a um `<video>` e pede para tocar de novo
 * quando a faixa volta.
 *
 * `autoPlay` só corre na montagem. A faixa de tela nasce muda — o primeiro
 * quadro ainda não chegou, a janela foi minimizada, ou o LiveKit pausou o
 * upstream (`replaceTrack(null)` depois do mudo). O elemento fica pausado no
 * último quadro e, no `unmute`, ninguém chama `play()`: a transmissão lê
 * como travada.
 *
 * Não escuta `pause`. Pausar de propósito (mudo local, "só áudio") lutaria
 * com um `play()` automático.
 */
export function anexarVideo(el: HTMLVideoElement, faixa: MediaStreamTrack): () => void {
  el.srcObject = new MediaStream([faixa]);
  const tocar = () => {
    void el.play().catch(() => undefined);
  };
  tocar();
  faixa.addEventListener("unmute", tocar);
  return () => {
    faixa.removeEventListener("unmute", tocar);
    el.srcObject = null;
  };
}
