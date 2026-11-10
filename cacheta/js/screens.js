/* =========================================================
   FEED DA TELA INICIAL
========================================================= */

let homeStatusFeedTimer = null;
let homeStatusFeedIndex = 0;

const HOME_STATUS_FEED = [
  "💡 Você pode bater com quadra e quina.",
  "🃏 O coringa não pode ser descartado.",
  "🔥 Sequências devem ser formadas pelo mesmo naipe.",
  "🎴 Trincas usam cartas do mesmo valor e naipes diferentes.",
  "🎯 Bater com a dez, sem descarte, vale 2 pontos.",
  "🎯 Se você é o mão da rodada, pode jogar com a vira.",
  "⚡ Confira todas as combinações antes de declarar BATI.",
  "🃏 É permitido usar dois coringas em uma carta para bater.",
  "👏 Para bater, selecione as cartas e forme todos os jogos válidos.",
  "⚪ Bate com descarte vale 1 ponto.",
  "🎯 É permitido bater com a vira.",
  "🎯 Se você está quimado, não pode pegar carta do lixo.",

];

function ensureHomeStatusFeed() {
  const statusCard = document.querySelector(
    "#homeScreen .home-status"
  );

  if (!statusCard) {
    return;
  }

  let feed = document.getElementById("homeStatusFeed");

  if (!feed) {
    statusCard.insertAdjacentHTML(
      "beforeend",
      `
        <div id="homeStatusFeed" class="home-status-feed">
          <div class="home-status-feed-text"></div>
        </div>
      `
    );

    feed = document.getElementById("homeStatusFeed");
  }

  const textElement = feed?.querySelector(
    ".home-status-feed-text"
  );

  if (!textElement) {
    return;
  }

  const renderFeed = () => {
    const message =
      HOME_STATUS_FEED[
        homeStatusFeedIndex % HOME_STATUS_FEED.length
      ];

    textElement.textContent = message;
    homeStatusFeedIndex += 1;
  };

  renderFeed();

  if (homeStatusFeedTimer) {
    clearInterval(homeStatusFeedTimer);
  }

  homeStatusFeedTimer = setInterval(
    renderFeed,
    3500
  );
}

/* =========================================================
   NAVEGAÇÃO ENTRE TELAS
========================================================= */

export function showScreen(idToShow) {
  const screenMap = {
    home: "homeScreen",
    tables: "tablesScreen",
    game: "game",
    homeScreen: "homeScreen",
    tablesScreen: "tablesScreen"
  };

  const targetId = screenMap[idToShow] || idToShow;

  const screenIds = [
    "homeScreen",
    "tablesScreen",
    "game"
  ];

  for (const screenId of screenIds) {
    const screen = document.getElementById(screenId);

    if (!screen) {
      continue;
    }

    screen.style.display =
      screenId === targetId
        ? ""
        : "none";
  }

  if (targetId === "homeScreen") {
    setTimeout(
      ensureHomeStatusFeed,
      50
    );
  }
}