import { state, currentPlayer } from "./state.js";
import {
  isSequenciaComCoringaValida,
  valorIndex,
  guardiaoRegra4,
  canPlaceCardOnTable,
  isValidSequence,
  isValidTrinca,
  normalizeSequence,
  isSequenciaComCoringa
} from "./rules.js";
import {
  guardiaoRodadaEncerrada,
  validaBatida,
  applyRoundScoring,
  finalizeMatchIfNeeded
} from "./endgame.js";
import { initDeck, shuffleDeck } from "./deck.js";
import { renderAll } from "./app.js";
import { stopTurnTimer } from "./turnTimer.js";
import { flyCard } from "./render.js";


export function initPlayers(qtd) {
  if (qtd < 2 || qtd > 6) qtd = 2;

  state.players = [];

  for (let i = 0; i < qtd; i++) {
    state.players.push({
      id: i,
      name: `Jogador ${i + 1}`,
      hand: [],
      jogosBaixados: [],
      totalPoints: 0,
      roundPoints: [],
      chips: 150000, // 💰 fichas (ajuste o valor inicial como quiser)
      avatarUrl: `https://i.pravatar.cc/80?img=${3 + i}`,
      
    });
  }

  state.currentPlayer = 0;
  state.selectedCards = [];
}

function ensureAnimQueue() {
  if (!Array.isArray(state.animQueue)) state.animQueue = [];
}

export function animMark(cardOrId, kind) {
  ensureAnimQueue();
  const id = typeof cardOrId === "object" ? cardOrId?.id : cardOrId;
  if (!id) return;
  state.animQueue.push({ id, kind });
}

// ======== SOM (beep curtinho estilo “carta”) ========
let _audioCtx = null;


function getAudioCtx() {
  if (_audioCtx) return _audioCtx;
  _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}


// ✅ chama isso em qualquer clique do usuário para destravar o áudio
export function unlockAudio() {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") ctx.resume();
  } catch (e) {}

  // ✅ também destrava o sistema de áudio do render.js
  try {
    window.unlockAudioOnce?.();
  } catch (e) {}
}

export function playCardSound(kind = "deal") {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") return; // só toca depois de unlock

    const now = ctx.currentTime;

    // “thwip” curto com ruído + filtro (soa mais como carta)
    const duration = 0.09;

    // noise buffer
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.6;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(kind === "discard" ? 900 : 700, now);

    const gain = ctx.createGain();
    // volume bem mais alto
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start(now);
    noise.stop(now + duration);
  } catch (e) {
    // ignora
  }
}

// ✅ Som de distribuição em rajada (usado no startNextRound e deals)
function playDealBurst(n = 9) {
  let i = 0;
  const t = setInterval(() => {
    playCardSound("deal");
    i++;
    if (i >= n) clearInterval(t);
  }, 35);
}

export function playVictorySound() {
  try {
    const ctx = getAudioCtx();

    // tenta destravar se estiver suspenso
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    function tone(freq, start, duration, gainValue = 0.06, type = "triangle") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + duration);
    }

    // sequência curta de vitória
    tone(660, now + 0.00, 0.10, 0.05, "triangle");
    tone(880, now + 0.12, 0.12, 0.055, "triangle");
    tone(1100, now + 0.26, 0.16, 0.06, "triangle");
  } catch (e) {
    // ignora
  }
}


function revertPendingJokerSwap() {
  const swap = state?.pendingJokerSwap;
  if (!swap) return false;

  const { gameIndex, joker, real } = swap;

  const jogo = state.table?.[gameIndex];
  if (!jogo || jogo.type !== "SEQUENCIA" || !Array.isArray(jogo.cards)) {
    state.pendingJokerSwap = null;
    state.mustUseJokerId = null;
    return false;
  }

  // 1) devolve o coringa para a sequência (trocando de volta no lugar da real)
  const idxRealNaMesa = jogo.cards.findIndex(c => c && c.id === real.id);
  if (idxRealNaMesa !== -1) {
    const restaurada = [...jogo.cards];
    restaurada[idxRealNaMesa] = joker;

    // tenta normalizar (mantém a sequência bonitinha)
    const norm = normalizeSequence(restaurada);
    jogo.cards = norm || restaurada;
  }

  // 2) remove o coringa da mão e devolve a carta real para a mão
  const mao = currentPlayer().hand || [];
  const idxJokerNaMao = mao.findIndex(c => c && c.id === joker.id);
  if (idxJokerNaMao !== -1) {
    mao.splice(idxJokerNaMao, 1);
  }
  mao.push(real);

  // 3) limpa obrigação
  state.pendingJokerSwap = null;
  state.mustUseJokerId = null;

  // limpa seleção pra evitar “estado estranho”
  state.selectedCards = [];

  return true;
}


export function dealInitialCards(qtd = 9) {
  state.players.forEach(player => {
    player.hand = [];

    for (let i = 0; i < qtd; i++) {
      const card = state.deck.pop();
      if (!card) break;
      player.hand.push(card);
    }
  });

  playDealBurst(qtd);
}


export function jogarComAVira() {
  if (!(state?.room?.id)) {
    showGameNotice("Esta ação só funciona em uma mesa online.");
    return false;
  }

  if (state.spectator) {
    showGameNotice("Você está assistindo. Não pode jogar.");
    return false;
  }

  if (
    Number(state.mySeat) !==
    Number(state.primeiroCompradorSeat)
  ) {
    showGameNotice(
      "Somente o primeiro jogador pode jogar com a vira."
    );
    return false;
  }

  if (
    Number(state.mySeat) !==
    Number(state.currentSeat)
  ) {
    showGameNotice("Aguarde sua vez.");
    return false;
  }

  if (state.faseTurno !== "COMPRAR") {
    showGameNotice("A opção de jogar com a vira não está disponível.");
    return false;
  }

  if (!state.viraDisponivelParaJogar) {
    showGameNotice("A opção de jogar com a vira já foi encerrada.");
    return false;
  }

  if (typeof window.wsSendAction !== "function") {
    showGameNotice("Conexão online indisponível.");
    return false;
  }

  state.selectedCards = [];

  window.wsSendAction({
    type: "playWithVira"
  });

  return true;
}

export function comprarDoMonte() {
  // =============================
  // ONLINE (servidor autoritativo)
  // =============================
  if (state?.room?.id && typeof window.wsSendAction === "function") {
    if (state.spectator) {
      showGameNotice("👁️ Você está assistindo. Não pode jogar.");
      return;
    }

    if (state.mySeat != null && state.currentSeat != null && state.mySeat !== state.currentSeat) {
      showGameNotice("⏳ Não é a sua vez.");
      return;
    }

    // Só compra na fase correta (o servidor também valida)
    if (state.faseTurno && state.faseTurno !== "COMPRAR") {
      showGameNotice("❌ Fase inválida.");
      return;
    }

    // ✅ No online, NÃO MUDE state aqui.
    // ❌ NÃO faça: state.faseTurno = "DESCARTAR";

    const myPlayer = currentPlayer?.();
    state.pendingDrawFromDeck = {
      requestedAt: Date.now(),
      handBeforeIds: Array.isArray(myPlayer?.hand)
        ? myPlayer.hand.map(c => String(c.id))
        : []
    };

    window.wsSendAction({ type: "drawDeck" });
    return;
  }


  // =============================
  // OFFLINE (seu código antigo)
  // =============================
  if (!guardiaoRodadaEncerrada()) return;
  if (!guardiaoRegra4("COMPRAR")) return;

  if (
    state.faseTurno === "BAIXAR" &&
    state.origemCompra === "LIXO" &&
    state.cartaDoLixo &&
    !state.baixouComLixo
  ) {
    desistirDoLixoEPassar();
    return;
  }

  if (state.turnoTravado) return;
  if (state.faseTurno !== "COMPRAR") return;

  if (state.jaComprouNoTurno) {
    showGameNotice("❌ Você já comprou neste turno.");
    return;
  }

  const carta = state.deck.pop();
  if (!carta) return;

  currentPlayer().hand.push(carta);
  state.jaComprouNoTurno = true;
  animMark(carta, "deal");
  playCardSound("deal");

  state.selectedCards = [];
  state.origemCompra = "MONTE";
  state.cartaDoLixo = null;
  state.baixouComLixo = false;

  state.faseTurno = "DESCARTAR";
  state.obrigacaoBaixar = false;
  state.fase = "BAIXAR";
  state.bloqueioLixoAteComprarMonte = false;
}

export function toggleSelectCard(cardId) {
  // não bloqueia seleção em turnos que você quiser, mantenha se já tiver regra
  if (!state.selectedCards) state.selectedCards = [];

  // ✅ GUARDA O ID COMO ELE VEM (não transforma em String)
  const idx = state.selectedCards.findIndex(x => String(x) === String(cardId));
  if (idx === -1) state.selectedCards.push(cardId);
  else state.selectedCards.splice(idx, 1);
}

export function toggleSelectVira() {
  if (!Array.isArray(state.selectedCards)) {
    state.selectedCards = [];
  }

  const marcador = "__VIRA__";

  const idx = state.selectedCards.findIndex(
    id => String(id) === marcador
  );

  if (idx >= 0) {
    state.selectedCards.splice(idx, 1);
  } else {
    state.selectedCards.push(marcador);
  }

  if (typeof window.renderAll === "function") {
    window.renderAll();
  }
}

export function discardSelectedCard() {
  console.log("🔥 DISCARD ENVIADO");

  // =====================================================
  // CACHETA PLAY — DESCARTE CONTROLADO PELO SERVIDOR
  // =====================================================

  if (!state?.room?.id || typeof window.wsSendAction !== "function") {
    showGameNotice("Conexão com a mesa indisponível.");
    return;
  }

  // Espectadores não podem descartar
  if (state.spectator) {
    showGameNotice("👁️ Você está assistindo. Não pode jogar.");
    return;
  }

  // Somente o jogador da vez pode descartar
  if (
    state.mySeat != null &&
    state.currentSeat != null &&
    state.mySeat !== state.currentSeat
  ) {
    showGameNotice("⏳ Não é a sua vez.");
    return;
  }

  // Verifica a fase da rodada
  if (
    state.faseTurno !== "BAIXAR" &&
    state.faseTurno !== "DESCARTAR"
  ) {
    showGameNotice("Fase inválida.");
    return;
  }

  // Exige exatamente uma carta selecionada
  if (!state.selectedCards || state.selectedCards.length !== 1) {
    showGameNotice("Selecione uma única carta para descartar");
    return;
  }

  const player = currentPlayer();
  const selectedId = state.selectedCards[0];

  // Tratamento especial da vira
  const descartandoVira = String(selectedId) === "__VIRA__";

  console.log("[CLIENT] selectedId =", selectedId);
  console.log(
    "[CLIENT] hand ids =",
    (player?.hand || []).map(c => c.id)
  );

  // Localiza a carta selecionada
  const found = descartandoVira
    ? (state.room?.cartaVira || state.cartaVira || null)
    : (player?.hand || []).find(
        c => String(c.id) === String(selectedId)
      );

  if (!found) {
    showGameNotice(
      descartandoVira
        ? "A vira não está disponível."
        : "Carta inválida: selecione novamente."
    );

    state.selectedCards = [];

    if (typeof window.renderAll === "function") {
      window.renderAll();
    }

    return;
  }

  // Preserva o formato do ID esperado pelo servidor
  const cardIdToSend = descartandoVira
    ? "__VIRA__"
    : (
        Number.isFinite(Number(found.id))
          ? Number(found.id)
          : found.id
      );

  console.log(
    "[CLIENT] discard -> cardId:",
    cardIdToSend,
    "(type:",
    typeof cardIdToSend,
    ")"
  );

  // Envia o descarte ao servidor
  window.wsSendAction({
    type: "discard",
    cardId: cardIdToSend
  });

  state.selectedCards = [];
}

function confirmBatida(reason = "") {
  return false;
}

export function layDownSelectedSet() {
  // =============================
  // ONLINE (servidor autoritativo)
  // =============================
  if (state?.room?.id && typeof window.wsSendAction === "function") {
    if (state.spectator) {
      showGameNotice("👁️ Você está assistindo. Não pode jogar.");
      return;
    }

    if (state.mySeat != null && state.currentSeat != null && state.mySeat !== state.currentSeat) {
      showGameNotice("⏳ Não é a sua vez.");
      return;
    }

    // ✅ no online, baixar só é permitido na fase BAIXAR
    if (state.faseTurno !== "BAIXAR") {
      showGameNotice("Fase inválida para baixar: " + state.faseTurno);
      return;
    }

    if (!state.selectedCards || state.selectedCards.length < 3) {
      showGameNotice("Selecione ao menos 3 cartas");
      return;
    }

    // ✅ manda os ids pro servidor
    const cardIds = state.selectedCards.map(x => x);
  console.log("[CLIENT] playMeld -> cardIds:", cardIds);

  const cardSnapshots = cardIds.map((id) => {
  const el = document.querySelector(`.card[data-card-id="${String(id)}"]`);
  const rect = el?.getBoundingClientRect?.();
    return {
      id: String(id),
      rect: rect
        ? {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
          }
        : null
    };
  });

  state.pendingPlayToTable = {
    cardIds: [...cardIds],
    cardSnapshots,
    requestedAt: Date.now()
  };

  window.wsSendAction({ type: "playMeld", payload: { cardIds } });

  // limpa seleção local (servidor vai mandar state atualizado)
  state.selectedCards = [];
  return;
  }

}

export function addCardToTableGame(gameIndex) {
  // CACHETA PLAY:
  // Não permite adicionar cartas a jogos baixados.
  // Os jogos são apresentados somente na BATIDA.
  return;
}


export function requestStartBatidaComViraAttempt() {
  if (!(state?.room?.id)) {
    showGameNotice(
      "BATI com a vira só funciona dentro de uma mesa online."
    );

    return false;
  }

  if (state.spectator) {
    showGameNotice(
      "Você está assistindo e não pode bater."
    );

    return false;
  }

  if (
    state.phase !== "COMPRAR" ||
    !state.viraDisponivelParaJogar
  ) {
    showGameNotice(
      "BATI com a vira só está disponível antes da primeira compra."
    );

    return false;
  }

  if (
    typeof window.wsSendAction !== "function"
  ) {
    showGameNotice(
      "Conexão online indisponível."
    );

    return false;
  }

  state.selectedCards = [];

  window.wsSendAction({
    type: "startBatidaComViraAttempt"
  });

  return true;
}


export function requestStartCrazyBatidaAttempt() {
  console.log("[BATI] entrou em requestStartCrazyBatidaAttempt");

  if (!(state?.room?.id)) {
    if (typeof showGameNotice === "function") {
      showGameNotice("BATI só funciona dentro de uma mesa online.");
    }
    console.warn("[BATI] sem room.id");
    return false;
  }

  if (typeof window.wsSendAction !== "function") {
    if (typeof showGameNotice === "function") {
      showGameNotice("Conexão online indisponível para BATI.");
    }
    console.warn("[BATI] window.wsSendAction não existe");
    return false;
  }

  console.log("[BATI] enviando startCrazyBatidaAttempt", {
    roomId: state.room?.id,
    mySeat: state.mySeat,
    phase: state.phase,
    currentSeat: state.currentSeat,
    variant: state.room?.variant || state.variant
  });
  window.wsSendAction({ type: "startCrazyBatidaAttempt" });
  return true;
}


export function requestCancelCrazyBatidaAttempt() {
  if (!(state?.room?.id)) {
    if (typeof showGameNotice === "function") {
      showGameNotice("Mesa inválida para cancelar BATI.");
    }
    console.warn("[BATI] cancel sem room.id");
    return false;
  }

  if (typeof window.wsSendAction !== "function") {
    if (typeof showGameNotice === "function") {
      showGameNotice("Conexão online indisponível para cancelar BATI.");
    }
    console.warn("[BATI] cancel sem wsSendAction");
    return false;
  }

  console.log("[BATI] enviando cancelCrazyBatidaAttempt", {
    roomId: state.room?.id,
    mySeat: state.mySeat
  });

  window.wsSendAction({ type: "cancelCrazyBatidaAttempt" });
  return true;
}


export function requestReentry() {
  return false;
}


export function declineReentry() {
  return false;
}


export function startNextRound() {
  return;
}


export async function nextPlayer() {

  // 🛑 ONLINE → servidor controla o turno
  if (state?.room?.id) {
    return;
  }

  stopTurnTimer();

  if (state.rodadaEncerrada || state.faseTurno === "FIM_RODADA") {
    state.turnoTravado = false;
    state.jaComprouNoTurno = false;

    startNextRound();
    return;
  }

  state.selectedCards = [];
  state.currentPlayer = getNextActivePlayerIndex(state.currentPlayer);

  state.turnoTravado = false;
  state.jaComprouNoTurno = false;
  state.faseTurno = "COMPRAR";
}


// =============================
// BOT (MVP) — sem coringa
// compra do monte -> tenta baixar sequência/trinca simples -> descarta
// =============================

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getBotPlayer() {
  const p = currentPlayer();
  return p && p.isBot ? p : null;
}

// acha uma trinca clássica (3 cartas mesmo valor, 3 naipes distintos), sem coringa
function findSimpleTrinca(hand) {
  const cards = hand.filter(c => c && !c.isJoker);

  const byValor = new Map();
  for (const c of cards) {
    if (!byValor.has(c.valor)) byValor.set(c.valor, []);
    byValor.get(c.valor).push(c);
  }

  for (const [valor, list] of byValor.entries()) {
    // precisa de 3 NAIPES distintos na trinca inicial
    const bySuit = new Map();
    for (const c of list) {
      if (!bySuit.has(c.naipe)) bySuit.set(c.naipe, c);
    }
    if (bySuit.size >= 3) {
      return Array.from(bySuit.values()).slice(0, 3);
    }
  }

  return null;
}

// acha uma sequência simples (>=3) por naipe, sem coringa
function findSimpleSequence(hand) {
  const cards = hand.filter(c => c && !c.isJoker);

  // agrupa por naipe
  const bySuit = new Map();
  for (const c of cards) {
    if (!bySuit.has(c.naipe)) bySuit.set(c.naipe, []);
    bySuit.get(c.naipe).push(c);
  }

  for (const [naipe, list] of bySuit.entries()) {
    // ordena por valorIndex
    const sorted = [...list].sort((a, b) => valorIndex(a.valor) - valorIndex(b.valor));

    // remove duplicados por valor (mantém 1)
    const uniq = [];
    const seen = new Set();
    for (const c of sorted) {
      const k = c.valor;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(c);
    }

    // acha “runs” consecutivos
    let run = [uniq[0]];
    for (let i = 1; i < uniq.length; i++) {
      const prev = run[run.length - 1];
      const cur = uniq[i];

      const d = valorIndex(cur.valor) - valorIndex(prev.valor);
      if (d === 1) {
        run.push(cur);
      } else {
        if (run.length >= 3 && isValidSequence(run)) return run.slice(0, 3);
        run = [cur];
      }
    }

    if (run.length >= 3 && isValidSequence(run)) return run.slice(0, 3);
  }

  return null;
}

function canPlaceCardOnAnyTableGame(card) {
  if (!card || card.isJoker) return false;
  if (!Array.isArray(state.table)) return false;

  for (const jogo of state.table) {
    if (!jogo || !Array.isArray(jogo.cards)) continue;

    // ===== SEQUÊNCIA =====
    if (jogo.type === "SEQUENCIA") {
      const tentativa = [...jogo.cards, card];

      // usa sua validação mais forte (gaveta + as alto/baixo)
      if (typeof isSequenciaComCoringaValida === "function") {
        if (isSequenciaComCoringaValida(tentativa)) {
          const norm = normalizeSequence(tentativa);
          if (norm) return true;
        }
      }
    }

    // ===== TRINCA (Pontinho Clássico) =====
    if (jogo.type === "TRINCA") {
      const reais = jogo.cards.filter(c => c && !c.isJoker);
      if (!reais.length) continue;

      const valorAlvo = reais[0].valor;
      if (card.valor !== valorAlvo) continue;

      const allowed = Array.isArray(jogo.allowedSuits)
        ? jogo.allowedSuits
        : Array.from(new Set(reais.map(c => c.naipe)));

      if (allowed.includes(card.naipe)) return true;
    }
  }

  return false;
}


function pickDiscardCard(hand) {
  const cards = (hand || []).filter(c => c && !c.isJoker);
  if (!cards.length) return null;

  const weight = (c) => {
    if (c.valor === "A") return 15;
    if (c.valor === "J" || c.valor === "Q" || c.valor === "K") return 10;
    const n = Number(c.valor);
    return Number.isFinite(n) ? n : 0;
  };

  // 1) primeiro tenta descartar algo que NÃO encaixa em nada na mesa
  const naoColocaveis = cards.filter(c => !canPlaceCardOnAnyTableGame(c));
  const pool = naoColocaveis.length ? naoColocaveis : cards;

  // 2) dentre elas, joga fora a mais “pesada”
  let best = pool[0];
  let bestPts = weight(best);

  for (const c of pool) {
    const pts = weight(c);
    if (pts > bestPts) {
      bestPts = pts;
      best = c;
    }
  }

  return best;
}


export async function botTakeTurn() {
  const bot = getBotPlayer();
  if (!bot) return;

  // pequena pausa “humana”
  // bot “pensa” 2 a 6s antes de agir
  await sleep(8000 + Math.random() * 10000);


  // 1) compra do monte
  comprarDoMonte();
  renderAll?.();

  await sleep(6000);

  // 2) tenta baixar um jogo simples (sem coringa)
  // prioridade: sequência, depois trinca (você pode inverter se quiser)
  let set = findSimpleSequence(bot.hand) || findSimpleTrinca(bot.hand);

  if (set && set.length >= 3) {
    state.selectedCards = set.map(c => c.id);
    layDownSelectedSet();
    renderAll?.();

    await sleep(6000);
  }

      // 3) descarta (se ainda estiver com cartas)
  state.faseTurno = "DESCARTAR";

  // tenta até 5 cartas diferentes pra não travar
  const tentadas = new Set();

  for (let tries = 0; tries < 5; tries++) {
    const d = pickDiscardCard(bot.hand.filter(c => c && !tentadas.has(c.id)));
    if (!d) break;

    tentadas.add(d.id);

    const before = bot.hand.length;

    state.selectedCards = [d.id];
    discardSelectedCard();
    renderAll?.();
      // ✅ bot terminou o turno: passa a vez (não espera o timer)
    await sleep(6000);
    await nextPlayer();
    renderAll?.();


    // se descartou, a mão diminui e saímos
    if (bot.hand.length < before) break;
  }


}


export function pegarDoLixo() {
  // =============================
  // ONLINE (servidor autoritativo)
  // =============================
  if (state?.room?.id && typeof window.wsSendAction === "function") {
    if (state.spectator) {
      showGameNotice("👁️ Você está assistindo. Não pode jogar.");
      return;
    }
    if (state.mySeat != null && state.currentSeat != null && state.mySeat !== state.currentSeat) {
      showGameNotice("⏳ Aguarde sua vez.");
      return;
    }

    const myPlayer = currentPlayer?.();
    state.pendingDrawFromDiscard = {
      requestedAt: Date.now(),
      handBeforeIds: Array.isArray(myPlayer?.hand)
        ? myPlayer.hand.map(c => String(c.id))
        : []
    };

    window.wsSendAction({ type: "drawDiscard" });
        return;
  }

  // =============================
  // OFFLINE (seu código antigo)
  // =============================
  if (!guardiaoRodadaEncerrada()) return;
  if (!guardiaoRegra4("COMPRAR")) return;
  if (state.faseTurno !== "COMPRAR") return;
  if (state.turnoTravado) return;

  if (state.bloqueioLixoAteComprarMonte) {
    showGameNotice("🚫 Lixo bloqueado: você só pode comprar do monte neste turno.");
    return;
  }

  const carta = state.lixo.pop();
  if (!carta) return;

  currentPlayer().hand.push(carta);
  state.jaComprouNoTurno = true;
  animMark(carta, "deal");
  playCardSound("deal");

  state.origemCompra = "LIXO";
  state.cartaDoLixo = carta;
  state.baixouComLixo = false;

  state.faseTurno = "BAIXAR";
  state.selectedCards = [];

  console.log("♻️ comprou do lixo (visível na mão)");
}


export function desistirDoLixoEPassar() {
  // só faz sentido se a compra foi do lixo e a carta ainda está marcada
  if (state.origemCompra !== "LIXO" || !state.cartaDoLixo) return;

  const carta = state.cartaDoLixo;

  // ✅ remove da mão (se ainda estiver lá)
  const mao = currentPlayer().hand || [];
  const idx = mao.findIndex(c => c && c.id === carta.id);
  if (idx !== -1) mao.splice(idx, 1);

  // ✅ devolve pro topo do lixo (pra manter consistência visual)
  state.lixo.push(carta);

  // ✅ limpa marcações do lixo
  state.cartaDoLixo = null;
  state.origemCompra = null;
  state.baixouComLixo = false;

  // ✅ trava o lixo até comprar do monte (regra que você já tinha)
  state.bloqueioLixoAteComprarMonte = true;

  // ✅ NÃO mexe em jaComprouNoTurno: ele já comprou (do lixo) e continua valendo
  // Ou seja, não pode comprar novamente depois disso.

  // ✅ encerra o turno como se tivesse descartado "automaticamente"
  state.selectedCards = [];
  state.faseTurno = "AGUARDANDO";
  state.turnoTravado = true;

  // passa a vez rapidinho (mesmo comportamento do descarte)
  autoNextTurn(1000);
}


export function devolverLixoComBloqueio() {
  if (state.origemCompra !== "LIXO" || !state.cartaDoLixo || state.baixouComLixo) return;

  const carta = state.cartaDoLixo;

  // remove da mão
  currentPlayer().hand = currentPlayer().hand.filter(c => c && c.id !== carta.id);

  // devolve ao lixo
  state.lixo.push(carta);

  // limpa flags do lixo do jogador atual
  state.cartaDoLixo = null;
  state.origemCompra = null;
  state.baixouComLixo = false;
  state.obrigacaoBaixar = false;

  // ✅ trava o lixo para o PRÓXIMO jogador até ele comprar do monte
  state.bloqueioLixoAteComprarMonte = true;

  // reset turno e passa a vez
  state.selectedCards = [];
  state.faseTurno = "COMPRAR";

  console.log("↩️ devolveu carta ao lixo; lixo bloqueado para o próximo jogador");

  // passa a vez pulando eliminados
  state.currentPlayer = getNextActivePlayerIndex(state.currentPlayer);
}

export function onClickLixo() {
  // se já pegou do lixo e ainda não baixou com ele,
  // clicar no lixo devolve e passa a vez (com bloqueio para o próximo)
  if (state.origemCompra === "LIXO" && state.cartaDoLixo && !state.baixouComLixo) {
    desistirDoLixoEPassar();
    return;
  }

  // senão, comportamento normal
  pegarDoLixo();
}

export function reorderHandByIds(fromId, toId) {
  const hand = currentPlayer().hand;

  const fromIndex = hand.findIndex(c => String(c.id) === String(fromId));
  const toIndex = hand.findIndex(c => String(c.id) === String(toId));

  if (fromIndex === -1 || toIndex === -1) return;

  const [moved] = hand.splice(fromIndex, 1);
  hand.splice(toIndex, 0, moved);

  console.log("🖐️ mão reordenada:", fromId, "->", toId);
}

export function addChips(playerId, amount) {
  const p = state.players.find(x => x.id === playerId);
  if (!p) return;
  if (typeof p.chips !== "number") p.chips = 0;
  p.chips += amount;
}

export function removeChips(playerId, amount) {
  addChips(playerId, -amount);
}


/* distribuir cartas uma a uma */
export async function dealInitialCardsAnimated(qtd = 9) {
  for (let i = 0; i < qtd; i++) {
    for (let pIndex = 0; pIndex < state.players.length; pIndex++) {
      const p = state.players[pIndex];
      if (!p) continue;

      const card = state.deck.pop();
      if (!card) return;

      p.hand.push(card);

      // renderiza para atualizar a mão no DOM
      renderAll?.();

      const monteEl = document.getElementById("monte");
      const handEl = document.getElementById("hand");
      const toEl = handEl?.lastElementChild;

      if (monteEl && toEl && window.__flyCard) {
        window.__flyCard({
          fromEl: monteEl,
          toEl,
          card,
          sfx: null,
          duration: 120
        });
      } else {
        // fallback: se não houver animação, toca pelo menos o som
        window.playSfx?.("deal");
      }

      // delay entre cartas
      await new Promise(r => setTimeout(r, 50));
    }
  }
}


export function autoNextTurn(delayMs = 100) {
  setTimeout(async () => {
    await nextPlayer();
    if (typeof window.renderAll === "function") {
      window.renderAll();
    }
  }, delayMs);
}


export function autoNextRound(delayMs = 8000) {
  return;
}


export function scheduleNextRoundWithRebuyWindow(ms = 8000) {
  return;
}


export function swapJokerOnTable(meldIndex, jokerIndex) {
  // ONLINE
  if (state?.room?.id && typeof window.wsSendAction === "function") {
    if (state.spectator) return showGameNotice("👁️ Você está assistindo. Não pode jogar.");

    if (state.mySeat != null && state.currentSeat != null && state.mySeat !== state.currentSeat) {
      return showGameNotice("⏳ Não é a sua vez.");
    }

    if (state.faseTurno !== "BAIXAR") {
      return showGameNotice("Fase inválida para trocar coringa: " + state.faseTurno);
    }

    if (!state.selectedCards || state.selectedCards.length !== 1) {
      return showGameNotice("Selecione 1 carta real da sua mão para substituir o coringa.");
    }

    const cardId = state.selectedCards[0];

    window.wsSendAction({
      type: "swapJoker",
      payload: { meldIndex, jokerIndex, cardId }
    });

    state.selectedCards = [];
    return;
  }

  showGameNotice("Troca de coringa só está disponível no modo online (servidor autoritativo).");
}
