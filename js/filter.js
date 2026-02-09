import { state } from './state.js';

import { createWorkItem } from './renderer.js';



export function applyFilter(filter, isInitialLoad = false) {

state.data.currentFilter = filter;

const grid = document.getElementById("works-grid");

const filterLinks = document.querySelectorAll(".filter-link");


// アクティブ状態の更新

filterLinks.forEach((l) => l.classList.remove("active"));

const activeLink = document.querySelector(`[data-filter="${filter}"]`);

if (activeLink) {

activeLink.classList.add("active");

}



// フィルタリングされた作品リストを作成

if (filter === "all") {

state.data.filteredWorks = [...state.data.allWorks];

} else {

state.data.filteredWorks = state.data.allWorks.filter(work => work.tags.includes(filter));

}


// 初期ロードで既にコンテンツがある場合はクリアをスキップ
if (isInitialLoad && filter === "all" && grid.children.length > 0) {
  // 既存のDOMから状態を初期化
  state.data.displayedCount = grid.children.length;
  return;
}

// グリッドをクリアして最初からロード

grid.innerHTML = "";

state.data.displayedCount = 0;


// 最初のバッチをロード

loadMoreItems();

}



export function loadMoreItems() {

if (state.data.isLoading || state.data.displayedCount >= state.data.filteredWorks.length) return;


state.data.isLoading = true;

try {

const grid = document.getElementById("works-grid");

if (!grid) return;


const endIndex = Math.min(state.data.displayedCount + 16, state.data.filteredWorks.length);


for (let i = state.data.displayedCount; i < endIndex; i++) {

const article = createWorkItem(state.data.filteredWorks[i]);

if (article) {

grid.appendChild(article);

}

}


state.data.displayedCount = endIndex;

} catch (error) {

console.error("Error loading items:", error);

} finally {

state.data.isLoading = false;

// ローディングインジケーターの更新

updateLoadingIndicator();

}

}



export function setupInfiniteScroll() {

if (state.init.infiniteObserver) return; // ← 本当の重複防止



const sentinel = document.createElement("div");

sentinel.id = "scroll-sentinel";

sentinel.style.height = "1px";

document.querySelector(".top-post-container").appendChild(sentinel);



state.init.infiniteObserver = new IntersectionObserver((entries) => {

entries.forEach((entry) => {

if (entry.isIntersecting && !state.data.isLoading) {

loadMoreItems();

}

});

}, {

rootMargin: "200px"

});



state.init.infiniteObserver.observe(sentinel);

}



export function updateLoadingIndicator() {

let indicator = document.getElementById("loading-indicator");


if (state.data.displayedCount >= state.data.filteredWorks.length) {

// すべて表示済み - インジケーターを削除

if (indicator) {

indicator.remove();

}

} else {

// まだ残りがある場合 - インジケーターを表示

if (!indicator) {

indicator = document.createElement("div");

indicator.id = "loading-indicator";

indicator.className = "loading-indicator";

indicator.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';

const sentinel = document.getElementById("scroll-sentinel");

if (sentinel) {

sentinel.parentNode.insertBefore(indicator, sentinel);

}

}

}

}



export function setupStateSaving() {

if (state.init.stateSavingInitialized) return;

state.init.stateSavingInitialized = true;

const grid = document.getElementById("works-grid");

grid.addEventListener("click", (e) => {

// リンクまたは画像の親リンクを探す

const link = e.target.closest("a");

if (link && link.href && (link.href.includes("works.html") || link.href.includes("/works/"))) {

const stateData = {

scrollTop: window.scrollY,

filter: state.data.currentFilter,

displayedCount: state.data.displayedCount || document.querySelectorAll("#works-grid .post").length

};

sessionStorage.setItem("slvgallo_scroll_state", JSON.stringify(stateData));

}

});

}



export function restoreScrollState() {

// ブラウザバックでの遷移かチェック

const navigationEntry = performance.getEntriesByType("navigation")[0];

const isBackNavigation = navigationEntry && navigationEntry.type === "back_forward";



if (!isBackNavigation) {

// 通常遷移の場合はストレージをクリア

sessionStorage.removeItem("slvgallo_scroll_state");

return false;

}



const savedStateJson = sessionStorage.getItem("slvgallo_scroll_state");

if (!savedStateJson) return false;



try {

const savedState = JSON.parse(savedStateJson);


// フィルタを復元

state.data.currentFilter = savedState.filter;

const filterLinks = document.querySelectorAll(".filter-link");

filterLinks.forEach((l) => l.classList.remove("active"));

const activeLink = document.querySelector(`[data-filter="${state.data.currentFilter}"]`);

if (activeLink) activeLink.classList.add("active");



// リストをフィルタリング

if (state.data.currentFilter === "all") {

state.data.filteredWorks = [...state.data.allWorks];

} else {

state.data.filteredWorks = state.data.allWorks.filter(work => work.tags.includes(state.data.currentFilter));

}

// ...

const grid = document.getElementById("works-grid");

grid.innerHTML = "";


// 表示数制限

const countToLoad = Math.min(savedState.displayedCount, state.data.filteredWorks.length);


for (let i = 0; i < countToLoad; i++) {

const article = createWorkItem(state.data.filteredWorks[i]);

grid.appendChild(article);

}


state.data.displayedCount = countToLoad;

updateLoadingIndicator();



// スクロール位置を復元（少し遅延させて描画完了を待つ）

requestAnimationFrame(() => {

window.scrollTo(0, savedState.scrollTop);

});


return true;

} catch (e) {

// 状態復元エラーは無視

return false;

}

}