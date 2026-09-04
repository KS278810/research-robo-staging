/* ResearchRobo 共有検査モジュール
   viewer.html と dispatch.html（ワークベンチ）の両方から読む純関数群。
   ブラウザ内だけで動く。外部送信・解析コードは一切含まない。 */
(function () {
  "use strict";

  /* 両KIT共通の禁止語（full §19.3・lite §5.3の両方が列挙）。 */
  var BANNED_WORDS_COMMON = [
    "再調査", "事実ベースレポート", "最終版", "改訂版", "Deep Research",
    "ハルシネーション監査済み", "Research KIT"
  ];
  /* full版のみ（§19.3）。お手軽版にはWorker概念自体が無いため、そのまま適用すると
     「Health Worker」等の正当な英語で誤検出する（2026-09-03 バグ再修正・A5） */
  var BANNED_WORDS_FULL = BANNED_WORDS_COMMON.concat(["WP", "Batch", "Worker", "ready", "review", "excluded", "locked", "withheld"]);
  /* lite版のみ（§5.3「確認済み・保留・除外を見出しにしない」）。本文中の地の文（「保留した」等）
     は正常な日本語なので、見出し（h2/h3）に出た場合だけ検出する */
  var BANNED_WORDS_LITE = BANNED_WORDS_COMMON;
  var BANNED_HEADING_WORDS_LITE = ["確認済み", "保留", "除外"];
  /* 互換名: 呼び出し側の既存コードはBANNED_WORDSをfull版の意味で使う */
  var BANNED_WORDS = BANNED_WORDS_FULL;

  /* source_typeの一次資料区分。v5.1は2文字コード（pr os ir gv ac pt）、v5.0以前のフルネームも受理 */
  var PRIMARY_TYPES = ["pr", "os", "ir", "gv", "ac", "pt",
    "press_release", "official_site", "ir_filing", "government", "academic_paper", "patent"];
  /* data-source-type の正規化表（フルネーム→2文字コード）。カテゴリ数の一意化に使う */
  var TYPE_CODE_OF = { press_release: "pr", official_site: "os", ir_filing: "ir", government: "gv", academic_paper: "ac", patent: "pt", news_primary: "n1", news_secondary: "n2", aggregator: "ag" };
  function typeCode(t) { t = String(t == null ? "" : t).trim().toLowerCase(); return TYPE_CODE_OF[t] || t; }

  /* 結果1件を追加する。label/detail はAI・機械向けの契約（RR-CHECK: 行）で不変。
     extra = { kind, title, next } は画面表示向けの追加情報:
       kind : "action"（要対応・赤）| "warn"（参考・黄）| "log"（自動処理）| "na"（対象外）| "ok"
       title: 素人向けの一言（未指定なら label をそのまま表示に使う）
       next : 次の一手（パネル共通の案内と違う場合だけ） */
  function addResult(list, ok, label, detail, extra) {
    extra = extra || {};
    list.push({
      ok: ok, label: label, detail: detail || "",
      kind: extra.kind || (ok ? "ok" : "action"),
      title: extra.title || label,
      next: extra.next || "",
      local: !!extra.local,
      /* 欠落した主張ID（check 17）。ビューアが「どのPARTを出し直すか」を
         PLANコメントから逆引きするために使う。RR-CHECK行の文面には影響しない */
      missingIds: extra.missingIds || [],
      /* 重複している部分のセレクタ/id（check 18）。ビューアが「どのPARTに
         重複の後発分があるか」を生PART本文から逆引きするために使う */
      dupSelectors: extra.dupSelectors || []
    });
  }

  /* 貼り付け内容の正規化: チャットのコードブロックをフェンス（```html … ```）ごと貼った
     場合に外側のフェンスだけを剥がし、ゼロ幅文字を除き、HTMLの前後にある説明文を
     切り落とす。検証・プレビュー・ダウンロードはすべてこの正規化後の文字列を使う。 */
  function normalizeInput(raw) {
    var s = String(raw || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
    var stripped = false;
    var trimmedOutside = false;
    var before = s;
    /* 閉じフェンスはバッククォート3連だけの行に限る（HTML内部の ```lang 行を
       閉じと誤認しないため） */
    s = s.replace(/^\s*```[a-zA-Z0-9_-]*[ \t]*\r?\n?/, "");
    s = s.replace(/\r?\n?[ \t]*```[ \t]*\s*$/, "");
    if (s !== before) stripped = true;

    /* 応答メッセージを丸ごと貼った場合（先頭の前置き・末尾の「保存とPDF化」案内など）に
       備えて、HTMLの外側の説明文を切り落とす。これをしないと </html> で終わらず
       「途中で切れている」と誤案内してしまう */
    var low = s.toLowerCase();
    var iDoc = low.indexOf("<!doctype");
    var iHtml = low.indexOf("<html");
    var start = (iDoc >= 0 && iHtml >= 0) ? Math.min(iDoc, iHtml) : (iDoc >= 0 ? iDoc : iHtml);
    if (start > 0) { s = s.slice(start); trimmedOutside = true; }
    /* 末尾の説明文がたまたま「</html>」という文字列に言及していると、末尾から
       検索する lastIndexOf はそこを本当の終端と誤認し、フェンス＋説明文ごと本文に
       結合してしまう。かといって単純に「最初の</html>」を採用すると、今度は
       PART結合で本物のHTMLが2つ連結された場合（重複ランドマーク検出の対象）に
       2つ目を切り捨ててしまう。両者を区別するため、</html>の候補ごとに「次の候補
       までの間にタグらしきもの（<英字）が続くか」を見る。続けば本物のHTMLがまだ
       続いている証拠なので次の候補へ進み、続かなければ（フェンス・説明文だけなら）
       そこが本当の終端とみなす */
    var low2 = s.toLowerCase();
    var iOpen2 = low2.lastIndexOf("<html");
    var iEnd = -1;
    if (iOpen2 >= 0) {
      var cursor2 = iOpen2;
      while (true) {
        var found2 = low2.indexOf("</html>", cursor2);
        if (found2 < 0) break;
        var tailStart2 = found2 + "</html>".length;
        var nextOcc2 = low2.indexOf("</html>", tailStart2);
        var tail2 = s.slice(tailStart2, nextOcc2 >= 0 ? nextOcc2 : s.length);
        var tailNoFence2 = tail2.replace(/^\s*```[a-zA-Z0-9_-]*\s*/, "").replace(/```\s*$/, "");
        if (!/<[a-zA-Z]/.test(tailNoFence2)) { iEnd = found2; break; }
        cursor2 = found2 + 1;
      }
    }
    if (iEnd < 0) iEnd = low2.lastIndexOf("</html>");
    if (iEnd >= 0) {
      var cutAt = iEnd + "</html>".length;
      if (s.slice(cutAt).trim() !== "") trimmedOutside = true;
      s = s.slice(0, cutAt);
    }
    return { html: s, strippedFence: stripped, trimmedOutside: trimmedOutside };
  }

  function parseDoc(html) {
    try { return new DOMParser().parseFromString(html, "text/html"); }
    catch (e) { return null; }
  }

  /* 本文テキストだけを取り出す（script/style/参考文献・付録・免責事項を除く）。禁止語スキャン用。
     2026-09-03(バグ再修正・A6): textContentは要素境界に区切りを入れないため、
     「</p><p>Worker が」のように前の要素の末尾がアルファベットで終わると
     語境界(\b)が消えて誤検出／見逃しが起きる。ブロック要素の境界（</p><p>等）だけに
     空白を入れる（<strong>禁止</strong>語のような同一段落内の隣接タグは対象外にし、
     地の文の連結を壊さない） */
  var RE_BLOCK_TAG = "p|div|li|h[1-6]|section|td|th|dd|dt|blockquote|ul|ol";
  var RE_BLOCK_BOUNDARY = new RegExp("(</(?:" + RE_BLOCK_TAG + ")>)\\s*(<(?:" + RE_BLOCK_TAG + ")\\b)", "gi");
  function bodyTextForScan(html) {
    var normalized = String(html || "").replace(RE_BLOCK_BOUNDARY, "$1 $2");
    var doc = parseDoc(normalized);
    if (doc && doc.body) {
      Array.prototype.forEach.call(doc.querySelectorAll("script, style, .references, .appendix, .disclaimer, #references, #apx-a, #apx-b"), function (el) { el.remove(); });
      return doc.body.textContent || "";
    }
    return normalized.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  }

  /* 禁止語検出用に h2/h3 の見出しテキストだけを結合したもの（lite版の確認済み/保留/除外用） */
  function headingTextForScan(html) {
    var doc = parseDoc(html);
    if (doc && doc.body) {
      return Array.prototype.map.call(doc.body.querySelectorAll("h2, h3"), function (el) { return el.textContent || ""; }).join(" ");
    }
    return "";
  }

  function runChecks(html, info) {
    var results = [];

    // 0. フェンス自動除去・前後の説明文除去の通知（NGではなく情報）
    if (info && info.strippedFence) {
      addResult(results, true, "コードブロックの外枠（バッククォート3連）を自動で取り除きました", "貼り付け範囲にフェンスが含まれていましたが、検証・保存には除去後の内容を使います。",
        { kind: "log", title: "貼り付け時の外枠の記号を取り除きました" });
    }
    if (info && info.trimmedOutside) {
      addResult(results, true, "前後の説明文を除去しました", "HTML（<!DOCTYPE …〜</html>）の前後にあった案内文を取り除いた内容で検証・保存します。応答メッセージを丸ごと貼り付けても問題ありません。",
        { kind: "log", title: "レポート本体の前後にあった説明文を取り除きました" });
    }
    // 0b. v5.1: PART結合・CSS付与・トークン置換の結果（該当する場合のみ表示。旧テンプレでは出ない）
    addV51InfoRows(results, info);

    // 1. スロット残存チェック
    var doubleSlots = html.match(/\{\{[^{}]*\}\}/g) || [];
    /* 日本語名のプレースホルダ（{題}{WP数}{想定読者}…）も検出する。KIT §19.2の例外に合わせ、
       <script>（JSON-LD）・<style>（ビューアが注入する組版CSS）・HTMLコメント内の { } は対象外。
       この除外が無いとCSSの宣言ブロックとJSON-LDを全部拾ってしまう */
    var scanText = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/\{\{[^{}]*\}\}/g, " ");
    var singleSlots = scanText.match(/\{[^{}\r\n]{1,60}\}/g) || [];
    var slotHits = doubleSlots.concat(singleSlots);
    var slotDetail = slotHits.length ? "検出: " + Array.from(new Set(slotHits)).slice(0, 8).join(", ") : "";
    if (info && info.tokens && info.tokens.unknown && info.tokens.unknown.length) {
      slotDetail += (slotDetail ? " ／ " : "") + "ビューアが計算できないトークン: " + info.tokens.unknown.join(", ") +
        "（使えるトークンは " + TOKEN_NAMES.join(" ") + " だけです）";
    }
    if (info && info.tokens && info.tokens.misplaced && info.tokens.misplaced.length) {
      slotDetail += (slotDetail ? " ／ " : "") + "タグの属性の中には置換できないトークン: " + info.tokens.misplaced.join(", ") + "（タグの外に書いてください）";
    }
    if (slotHits.some(function (h) { return /RR:\s*PERIOD/.test(h); })) {
      slotDetail += (slotDetail ? " ／ " : "") + "情報対象期間（PERIOD）のトークンが残っています。meta DC.coverage または表紙の「情報対象期間：」欄に {{RR:PERIOD}} 自身ではなく具体的な日付を記載してください（自己参照は解決できません）。";
    }
    addResult(results, slotHits.length === 0,
      "未置換のスロット・プレースホルダが残っていない", slotDetail,
      { title: slotHits.length === 0 ? "AIの埋め残しはありません" : "AIが埋めるべき箇所が空のまま残っています" });

    // 2. 引用番号 ↔ 参考文献の突合（付録 .appendix 内の項目は対象外）
    var used = new Set();
    var defined = new Set();
    var doc2 = parseDoc(html);
    var m;
    if (doc2 && doc2.body) {
      Array.prototype.forEach.call(doc2.querySelectorAll('a[href^="#ref-"]'), function (a) {
        if (a.closest && a.closest(".appendix")) return;
        var mm = (a.getAttribute("href") || "").match(/^#ref-(\d+)$/);
        if (mm) used.add(mm[1]);
      });
      Array.prototype.forEach.call(doc2.querySelectorAll('[id^="ref-"]'), function (el) {
        if (el.closest && el.closest(".appendix")) return;
        var mm = (el.getAttribute("id") || "").match(/^ref-(\d+)$/);
        if (mm) defined.add(mm[1]);
      });
    } else {
      var reUsed = /href=["']#ref-(\d+)["']/g;
      while ((m = reUsed.exec(html))) used.add(m[1]);
      var reDef = /id=["']ref-(\d+)["']/g;
      while ((m = reDef.exec(html))) defined.add(m[1]);
    }
    var missing = Array.from(used).filter(function (n) { return !defined.has(n); });
    var unused = Array.from(defined).filter(function (n) { return !used.has(n); });
    /* renumberRefs は runChecks より前に走るため、ここで見える番号は付け直し後の整数。
       AIが実際に書いたID（ref-{WP}-{S}）で伝えないと、AIは別の資料を誤修正してしまう
       （検査14と表記を揃える）。map を反転し、対応が無ければそのまま表示する */
    var origOf = {};
    if (info && info.renumber && info.renumber.map) {
      Object.keys(info.renumber.map).forEach(function (old) { origOf[String(info.renumber.map[old])] = old; });
    }
    function refLabel(n) { return "ref-" + (origOf[n] || n); }
    /* info.renumber がある場合、未使用番号は検査14（本文で引用されていない参考文献）が
       元のIDで既に報告するため、ここでは二重報告しない（「不足」半分だけを見る） */
    var suppressUnused = !!(info && info.renumber);
    var citeOk = missing.length === 0 && (suppressUnused || unused.length === 0) && used.size > 0;
    var citeDetail = "";
    if (missing.length) citeDetail += "本文にあるが参考文献に無い番号: " + missing.map(refLabel).join(", ") + "。";
    if (unused.length && !suppressUnused) citeDetail += "参考文献にあるが本文で使われていない番号: " + unused.map(refLabel).join(", ") + "。";
    if (used.size === 0) citeDetail += "引用番号が1件も見つかりませんでした。";
    var citeTitle;
    if (citeOk) citeTitle = "本文の引用番号と参考文献が過不足なく対応しています";
    else if (missing.length) citeTitle = "本文の引用番号に、対応する参考文献がないものがあります";
    else if (used.size === 0) citeTitle = "本文に引用番号が1つも見つかりません";
    else citeTitle = "参考文献リストに、本文で使われていない資料があります";
    /* 実走: {{RR:REFERENCES}}のような未知トークンで参考文献セクション自体が
       欠けたとき、この検査は125件の欠落番号を列挙する赤になった。原因（未知
       トークン）は検査1が既にPART特定つきで指摘しているため、この検査は
       その派生（読めない大量列挙）に過ぎない。検査1が未知トークンを検出して
       いる間はwarnへ落とし、AIには根本原因だけを送る（検査1を直せば消える）。
       ただし「参考文献セクションが実際に空（defined=0）」のときだけに限る——
       未知トークンが本文の別の場所に1個あるだけの無関係なケースで、本物の
       引用↔参考文献の不整合まで黙らせてしまわないように絞る */
    var citeDerivedFromUnknownToken = !!(info && info.tokens && info.tokens.unknown && info.tokens.unknown.length) && defined.size === 0;
    addResult(results, citeOk, "引用番号と参考文献リストが過不足なく対応している", citeDetail,
      citeDerivedFromUnknownToken && !citeOk
        ? { kind: "warn", title: citeTitle + "（上の未置換トークンの結果です。そちらを直すとここも解消します）" }
        : { title: citeTitle });

    // 3. 禁止語スキャン（script/style/参考文献を除いた本文テキスト。英語は語境界つき）
    var isLiteReport = !!(info && info.isLite);
    var textOnly = bodyTextForScan(html);
    var wordList = isLiteReport ? BANNED_WORDS_LITE : BANNED_WORDS_FULL;
    var bannedHits = wordList.filter(function (w) {
      if (w === "WP") {
        // 「WP01」「WP 3」のような内部ID表記は拾い、「WP.29」「WP29」（UNECE規則名。2桁固定）のような正当な語は除く
        return /\bWP(?!\.?\d{2}\b)(?:\s?\d{1,2})?\b/.test(textOnly);
      }
      if (/^[A-Za-z ]+$/.test(w)) {
        /* 2026-09-03(7回目・初実走FB): 英単語として厳密一致すると「peer review」「ready to
           use」のような正当な英語の地の文まで赤にする（実走で"review"が誤検出された）。
           Workerだけに適用していた日本語・数字隣接ルールを全ASCII内部語へ揃える */
        var esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(esc + "(?=[^\\x00-\\x7F\\s])|(?<=[^\\x00-\\x7F])" + esc + "|\\b" + esc + "\\s?\\d").test(textOnly);
      }
      return textOnly.indexOf(w) !== -1;
    });
    if (isLiteReport) {
      var headingText = headingTextForScan(html);
      bannedHits = bannedHits.concat(BANNED_HEADING_WORDS_LITE.filter(function (w) { return headingText.indexOf(w) !== -1; }));
    }
    addResult(results, bannedHits.length === 0,
      "内部用語・禁止語が本文に含まれていない",
      bannedHits.length ? "検出: " + bannedHits.join(", ") + "（出典名など正当な語の場合は無視して構いません）" : "",
      { title: bannedHits.length === 0 ? "内部用語の残りはありません" : "レポートに調査過程の内部用語が残っています" });

    // 4. コードフェンス記号の混入チェック（外枠除去後に、HTML内部に残っているもの）
    var hasFence = html.indexOf("```") !== -1;
    addResult(results, !hasFence,
      "コードフェンス記号（バッククォート3連）がHTML内部に混入していない",
      hasFence ? "HTMLの途中にバッククォート3連が含まれています。AIに「レポート内のバッククォート3連を取り除いて再出力して」と依頼してください。" : "",
      { title: hasFence ? "レポートの途中に貼り付け用の記号が混ざっています" : "貼り付け用の記号の混入はありません" });

    // 5. 文書の完結チェック
    var trimmed = html.trim();
    var closed = /<\/html>\s*$/i.test(trimmed);
    addResult(results, closed,
      "HTMLが </html> まで完結している（途中で切れていない）",
      closed ? "" : "末尾が </html> で終わっていません。続きの貼り足しではなく、AIに「出し直して」と依頼し、出力をもう一度このボックスに貼り付けてください。",
      { title: closed ? "レポートは最後まで揃っています" : "レポートが途中で切れています" });

    // 6以降. 構造・出典の機械判定（該当要素が無い項目は「対象なし」としてOK扱い）
    runStructureChecks(html, results, info);

    // 14以降. v5.1レポート限定の判定（PART／{{RR:*}}トークン／kit-version 5.1 が確認できた場合のみ）
    runV51Checks(html, results, info);

    return results;
  }

  /* ---- 構造・出典の機械判定 ----
     KITのテンプレートが付与するdata属性（data-source-type / data-claim /
     meta[name="rr:confirmed-count"]）を使う。付与しない旧テンプレでも壊れないよう、
     属性が無い場合は「対象なし」または情報行にとどめ、badにはしない。 */
  function digitsOf(s) { return String(s == null ? "" : s).replace(/[^0-9]/g, ""); }

  /* 日付らしい並びを YYYYMM(DD) の列へ正規化する。「2026年8月27日」「2026/8/27」
     「2026-08-27」を同一視し、表紙が自然な日本語表記でもmetaと一致と判定する
     （KITは表紙の日付の書式を縛らない）。日付らしい並びが片方にでも無ければ
     呼び出し側で digitsOf にフォールバックする */
  function pad2(n) { n = String(parseInt(n, 10)); return n.length < 2 ? "0" + n : n; }
  /* 日・月の直後に別の数字が続く場合は取り込まない（例: "2024-01/2026-07" の "/" は
     月日区切りではなく期間の区切りなので、"01" の後の "20" を日として誤読しない） */
  var RE_DATEISH = /(\d{4})\s*[年\/.\-]\s*(\d{1,2})(?!\d)(?:\s*[月\/.\-]\s*(\d{1,2})(?!\d))?/g;
  function dateKeys(s) {
    var t = toHalfDigits(String(s == null ? "" : s)), out = [], m;
    RE_DATEISH.lastIndex = 0;
    while ((m = RE_DATEISH.exec(t))) out.push(m[1] + pad2(m[2]) + (m[3] ? pad2(m[3]) : ""));
    return out.join(",");
  }

  function normalizeRefUrl(u) {
    var s = String(u == null ? "" : u).trim().toLowerCase();
    s = s.replace(/#.*$/, "");
    s = s.replace(/^https?:\/\//, "");
    s = s.replace(/^www\./, "");
    var qi = s.indexOf("?");
    if (qi >= 0) {
      var base = s.slice(0, qi);
      var kept = s.slice(qi + 1).split("&").filter(function (kv) { return kv && !/^utm_/.test(kv); });
      s = base + (kept.length ? "?" + kept.join("&") : "");
    }
    return s.replace(/\/+$/, "");
  }

  /* 全角数字→半角 */
  function toHalfDigits(str) {
    return String(str == null ? "" : str).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  }

  /* ドメイン→eTLD+1（独立発行元の推定）。dispatch.html から移設し両ページで共有する */
  var MULTI_TLD = ["co.jp", "go.jp", "or.jp", "ac.jp", "ne.jp", "lg.jp", "ed.jp", "gr.jp", "ad.jp", "co.uk", "org.uk", "gov.uk", "ac.uk", "com.au", "gov.au", "co.kr", "go.kr", "com.cn", "gov.cn", "co.in", "com.br", "com.tw", "gov.tw",
    "github.io", "pages.dev", "netlify.app", "blogspot.com", "hatenablog.com", "note.com", "wordpress.com", "medium.com", "prtimes.jp"];
  function domainOf(url) {
    var m = String(url || "").toLowerCase().match(/^[a-z]+:\/\/([^\/:?#]+)/);
    return m ? m[1].replace(/^www\./, "") : "";
  }
  function etld1(domain) {
    var parts = String(domain || "").split(".").filter(Boolean);
    if (parts.length <= 2) return domain || "";
    var last2 = parts.slice(-2).join(".");
    if (MULTI_TLD.indexOf(last2) !== -1) return parts.slice(-3).join(".");
    return last2;
  }

  function notInAppendix(el) { return !(el && el.closest && el.closest(".appendix")); }

  /* id（apx-a/apx-b）を落として自前の見出しだけで付録を書いた文書でも集計を
     取りこぼさないためのフォールバック。実走で、付録Bにidが付かず表紙の
     「未確認事項」が実態と異なる0件と表示された事例があった。h2の先頭一致で
     見出しテキストから探す（本文中の同名見出しと区別するため section.appendix
     クラス限定） */
  function appendixByHeading(doc, prefix) {
    var secs = doc.querySelectorAll("section.appendix");
    for (var i = 0; i < secs.length; i++) {
      var h2 = secs[i].querySelector("h2");
      if (h2 && (h2.textContent || "").trim().indexOf(prefix) === 0) return secs[i];
    }
    return null;
  }

  /* KIT §19.2 の body 順序で <div class="body-columns"> の外に来るべき要素
     （調査手法・参考文献・付録A/B・免責）。誤って内側に書かれた場合に autoRepair が正す */
  var TAIL_SEL = '#sec-method, #references, #apx-a, #apx-b, .references, .appendix, .disclaimer';

  /* 本文の引用に紐づく主張ID（C- で始まるもの）の一意集合。付録 .appendix 内は対象外。
     data-claim は「C-1-12 C-2-07」「C-012,C-044 X-01」のように複数IDを持てる */
  function citedClaimSet(doc, rawOut) {
    var set = {};
    if (!doc) return set;
    Array.prototype.forEach.call(doc.querySelectorAll("sup a[data-claim]"), function (a) {
      if (!notInAppendix(a)) return;
      String(a.getAttribute("data-claim") || "").split(/[\s,]+/).forEach(function (tok) {
        if (/^C-/.test(tok)) {
          var id = canonId(tok);
          set[id] = true;
          if (rawOut && !rawOut[id]) rawOut[id] = tok; /* 表示用に本文の書式（C-1-02等）を残す */
        }
      });
    });
    return set;
  }

  /* <!-- UNCITED: C-2-07(集約); C-3-11(scope外) --> または <!-- UNCITED: none --> を読む */
  /* <!-- UNCITED: C-2-07(集約→C-1-03); C-3-11(scope外)、C-4-02: 集約→C-1-05 --> または
     <!-- UNCITED: none --> を読む。区切りは ; ／ ； ／ 、 ／ , のいずれか。理由は
     括弧書き C-x(理由) と、コロン書き C-x: 理由 の両方を受理する。理由の中に
     「集約→C-x-yy」があれば統合先IDとして mergedInto に取り出す。ID自体が読めない断片・
     理由の形式が崩れている断片は unparsed に集めて情報行で知らせる（数量には含めない） */
  /* 区切り文字（; ； 、 ,）は括弧の外にあるときだけ有効にする。理由の文中に
     「、」があると（例: 集約→C-1-03、重要度低）そこで誤って分割され、理由も
     集約先IDも失われてしまう */
  function splitOutsideParens(str) {
    var out = [], cur = "", depth = 0;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      if (ch === "（" || ch === "(") depth++;
      else if ((ch === "）" || ch === ")") && depth > 0) depth--;
      if (depth === 0 && /[;；、,]/.test(ch)) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }

  function parseUncited(html) {
    var out = { present: false, none: false, entries: [], unparsed: [] };
    var re = /<!--\s*UNCITED\s*[:：]\s*([\s\S]*?)-->/gi, m;
    while ((m = re.exec(String(html || "")))) {
      out.present = true;
      var body = m[1].trim();
      if (/^none$/i.test(body) || body === "") { out.none = true; continue; }
      splitOutsideParens(body).forEach(function (piece) {
        var t = piece.trim();
        if (!t) return;
        var idm = t.match(/^(C-[A-Za-z0-9_-]+)/);
        if (!idm) { out.unparsed.push(t); return; }
        var id = canonId(idm[1]);
        var rest = t.slice(idm[0].length).trim();
        var reason = "";
        if (rest) {
          var pm = rest.match(/^[（(]([\s\S]*)[）)]$/);
          var cm = !pm && rest.match(/^[:：]\s*(.*)$/);
          if (pm) reason = pm[1].trim();
          else if (cm) reason = cm[1].trim();
          else out.unparsed.push(t);
        }
        var mergedInto = "";
        var mg = reason.match(/集約\s*[→>]\s*(C-[A-Za-z0-9_-]+)/);
        if (mg) mergedInto = canonId(mg[1]);
        out.entries.push({ id: id, rawId: idm[1], reason: reason, mergedInto: mergedInto });
      });
    }
    return out;
  }

  /* 2026-09-02（お手軽+DRのうまみ最大化・付加価値レバー）: 結果一覧（S/C/N/RECEIPT行、
     KIT §5.2の書式）をviewerへ任意で貼ると、原文抜粋・確認状態を成果物の付録Cへ
     出せる。DRレポート単体には無い「主張単位の検証可能性」を機械生成する。
     lite・full共通の行形式（1行1レコード、|区切り）をそのまま読む。フル版で複数WPの
     結果一覧を貼った場合、末尾の RESULT_COMPLETE: {wp_id} からWP識別子を拾っておく
     （本文の資料ID解決に使う。full版の集約後ID（C-2-07等）とは別物のため、
     解決できない場合はそのまま「未確定」として台帳に残すだけで機能は止めない） */
  /* dispatch.html の normLines と同一実装（2026-09-03 完成前の最終洗い出し・A2で統合。
     以前は別実装で、箇条書き・番号付き・太字・セル区切りをdispatchだけが剥がしていた
     ため、同じ結果一覧をdispatchは受理してもviewerは「断片です」と誤判定していた） */
  function normResultListLine(line) {
    var t = String(line == null ? "" : line).replace(/｜/g, "|").trim();
    t = toHalfDigits(t);
    var hadLeadingPipe = /^\|/.test(t);
    t = t.replace(/^\|\s*/, "");
    if (hadLeadingPipe) t = t.replace(/\s*\|$/, "");
    t = t.replace(/^-\s+/, "").replace(/^\d+\.\s+/, "");
    t = t.replace(/^\*\*/, "").replace(/\*\*$/, "");
    t = t.trim().replace(/\s*\|\s*/g, "|");
    return t;
  }

  function parseResultList(raw) {
    var rawStr = String(raw || "").replace(/﻿/g, "");
    var lines = rawStr.split(/\r?\n/);
    var sources = {}, claims = [], unconfirmed = [], receipt = "", wp = "";
    /* 2026-09-03(完成前の最終洗い出し・F5): §7.3の変換結果が60行超で分割されると、
       途中のブロックは`RESULT_COMPLETE`ではなく先頭行`RR-RESULT | … | WP_ID: WP1 | …`
       と末尾`RESULT_PART: {wp} k/n`だけを持つ。従来はwpの手がかりがRESULT_COMPLETE
       行だけだったため、分割ブロックではwp=""のままcanon IDがC-1相当に落ち、
       付録CのID・資料番号が食い違っていた（実走で確認済みの一覧との不一致と同型）。
       ヘッダ行から先に読み、RESULT_COMPLETE/RESULT_PARTがあれば後で上書きする */
    /* 2026-09-03(バグ再修正・A1): ヘッダ検出は正規化前のrawStrに対して行っていたため、
       太字・箇条書き・表形式（| RR-RESULT | … |）で装飾されるとWP_IDが読めなかった。
       他の行と同じくnormResultListLine適用後の行に対して読む */
    var normAll = lines.map(normResultListLine).join("\n");
    var mHead = normAll.match(/^\s*RR-RESULT\b[^\n]*WP_ID\s*[:：]\s*([A-Za-z0-9_-]+)/mi);
    if (mHead) {
      var wpHeadRaw = mHead[1].replace(/^WP/i, "").replace(/[^0-9A-Za-z]/g, "");
      wp = /^\d+$/.test(wpHeadRaw) ? String(parseInt(wpHeadRaw, 10)) : wpHeadRaw;
    }
    lines.forEach(function (line) {
      var t = normResultListLine(line);
      if (!t) return;
      if (/^(```|~~~)/.test(t)) return;
      if (/^:?-{2,}:?(\|:?-{2,}:?)+$/.test(t)) return;
      var mS = t.match(/^S(\d+)\|(.*)$/);
      if (mS) {
        var sf = mS[2].split("|");
        sources[mS[1]] = {
          sNum: mS[1], type: (sf[0] || "").trim(), publisher: (sf[1] || "").trim(),
          title: (sf[2] || "").trim(), date: (sf[3] || "").trim(), url: (sf[4] || "").trim(),
          viewOnly: /閲覧のみ/.test(sf[5] || "")
        };
        return;
      }
      var mC = t.match(/^C(\d+)\|(.*)$/);
      if (mC) {
        var cf = mC[2].split("|");
        claims.push({
          cNum: mC[1], sNum: (cf[0] || "").replace(/^S/i, "").trim(), qNum: (cf[1] || "").replace(/^Q/i, "").trim(),
          subject: (cf[2] || "").trim(), claim: (cf[3] || "").trim(),
          tags: (cf[4] || "").trim(), value: (cf[5] || "").trim(), excerpt: (cf[6] || "").trim()
        });
        return;
      }
      var mN = t.match(/^N\|(.*)$/);
      if (mN) { unconfirmed.push(mN[1]); return; }
      var mR = t.match(/^RECEIPT\|(.*)$/);
      if (mR) { receipt = mR[1]; return; }
      var mDone = t.match(/^RESULT_COMPLETE\s*[:：]\s*(\S+)/i);
      /* WP_IDは「WP2」のようにWP接頭辞つきで書かれる（full KIT §5.5）。参考文献IDの
         WP接頭辞は0詰めしない数字だけ（R|1-7|）なので、ここでもWPを剥がし、
         数字なら0詰めを取り除いて揃える（「WP02」のような表記でも解決できるように） */
      if (mDone) {
        var wpRaw = mDone[1].replace(/^WP/i, "").replace(/[^0-9A-Za-z]/g, "");
        wp = /^\d+$/.test(wpRaw) ? String(parseInt(wpRaw, 10)) : wpRaw;
        return;
      }
      /* 分割ブロック(k<n)の末尾行。RESULT_COMPLETEが無い代わりにこれがwp源になる */
      var mPart = t.match(/^RESULT_PART\s*[:：]\s*(\S+?)\s+\d+\s*\/\s*\d+/i);
      if (mPart) {
        var wpPartRaw = mPart[1].replace(/^WP/i, "").replace(/[^0-9A-Za-z]/g, "");
        wp = /^\d+$/.test(wpPartRaw) ? String(parseInt(wpPartRaw, 10)) : wpPartRaw;
        return;
      }
    });
    return { sources: sources, claims: claims, unconfirmed: unconfirmed, receipt: receipt, wp: wp,
             claimCount: claims.length, sourceCount: Object.keys(sources).length };
  }

  /* 結果一覧のC行（cNum）を本文の主張ID（data-claim）と同じcanon形式に変換する。
     lite（WP無し）は"C-{cNum}"のまま。full（WP接頭辞つき）は"C-{wp}-{cNum}"にする
     ——貼り付け時点ではAIはWPローカル番号（C7|S2|…）で書くため、これをしないと
     フル版の結果一覧は本文のC-2-07等と永遠に一致しない（実走で確認: 全行「一覧のみ」
     になり、check20が全件を誤って「本文に反映されていない」と警告した） */
  function ledgerClaimId(block, claim) {
    var wp = (block && block.wp) || "";
    return canonId("C-" + (wp ? wp + "-" : "") + claim.cNum);
  }

  /* 結果一覧のテキストかどうか（PART・完成レポートとは排他）。S/C/N/RECEIPT行が
     1行でも行頭にあれば結果一覧とみなす */
  function looksLikeResultList(raw) {
    var s = String(raw || "");
    if (/<!--\s*RR-PART/i.test(s) || /<html[\s>]/i.test(s) || /<!doctype/i.test(s)) return false;
    var norm = s.split(/\r?\n/).map(normResultListLine).join("\n");
    return /^S\d+\|/m.test(norm) || /^C\d+\|/m.test(norm) || /^RECEIPT\|/m.test(norm) || /^N\|/m.test(norm);
  }

  /* 貼り付けられた結果一覧群から付録C（主張台帳）のHTMLを作る。
     doc/htmlは展開・自動修復・再採番まで済んだ最終文書（本文の引用状態・参考文献番号を
     読むため）。refMapはrenumberRefs().map（AIが書いた資料ID→表示上の参考文献番号）。
     blocks は parseResultList() の返り値の配列（複数ブロックの貼付・60行分割に対応） */
  /* 2026-09-03(完成前の最終洗い出し・C8): オーナーの質問「引用先にエビデンスが乏しいものは
     検出できるか」への改善レバー。KIT本文の追加無しで、既に収集済みのS行type/date・C行
     excerptの有無だけから付録Cの各行にA〜Dの等級を機械算出する（新規解析は不要）。
     本文への印付けは今回入れない（実走後に検討。DECISIONS.md参照）。
     A＝一次資料(gv/pr/ir/os/ac/pt)かつ抜粋あり
     B＝一次資料だが抜粋なし、または二次資料(n1)で抜粋あり
     C＝二次資料(n2/ag)のみで抜粋あり
     D＝抜粋なしの二次資料、または発行日不明
     同じ主張を複数資料が支える場合はKIT側でC行そのものを分ける設計（§行動規則4）のため、
     台帳側でも資料ごとに別行になり、行をまたいだ等級の合成は不要 */
  function evidenceGrade(src, excerpt) {
    var hasExcerpt = !!(excerpt && String(excerpt).trim());
    if (!src) return "D";
    var dateUnknown = !src.date || !String(src.date).trim() || /不明|なし|N\/?A/i.test(src.date);
    if (dateUnknown) return "D";
    var type = String(src.type || "").trim().toLowerCase();
    var isPrimary = PRIMARY_TYPES.indexOf(type) !== -1;
    var isN1 = type === "n1";
    if (isPrimary) return hasExcerpt ? "A" : "B";
    if (isN1 && hasExcerpt) return "B";
    if (hasExcerpt) return "C";
    return "D";
  }

  function buildLedgerHtml(doc, html, blocks, refMap) {
    if (!blocks || !blocks.length) return null;
    var cited = citedClaimSet(doc);
    var uncitedReason = {};
    parseUncited(html).entries.forEach(function (e) { uncitedReason[e.id] = e.reason || ""; });
    var fullStyleId = /data-claim="[^"]*C-\d+-\d+/.test(html);
    var rows = [];
    /* 2026-09-03(完成前の最終洗い出し・C1): refMapのキーは本文に書かれた資料IDそのまま
       （0詰めが揺れうる）。素の突合で見つからない場合だけ、0詰めを剥がした
       canonId基準でも引けるようにする（既存の完全一致優先は変えない） */
    var canonRefMap = {};
    if (refMap) { Object.keys(refMap).forEach(function (k) { canonRefMap[canonId(k)] = refMap[k]; }); }
    /* 2026-09-03(バグ再修正・A4): 60行分割ではS行が最初のブロックにしか無いため、
       ブロック単位でsourcesを引くと2ブロック目以降は資料が引けず等級が常にDになる。
       同じwpのブロックを横断してS行をマージしてから引く */
    var sourcesByWp = {};
    blocks.forEach(function (b) {
      var key = b.wp || "";
      sourcesByWp[key] = sourcesByWp[key] || {};
      Object.keys(b.sources || {}).forEach(function (k) {
        if (!(k in sourcesByWp[key])) sourcesByWp[key][k] = b.sources[k];
      });
    });
    /* 2026-09-03(バグ再修正・A3): 同じ結果一覧の2回貼りは重複排除するが、§8.3が想定する
       「PART 2以降でC番号が1から再開する」場合は別ブロック＝別内容なので、捨てずに
       末尾英字（C-1-1b）で区別する。ブロック単位で先に完全再貼付だけを弾く */
    var blockSeen = {};
    var survivingBlocks = blocks.filter(function (b) {
      if (!b.receipt) return true;
      var sig = (b.wp || "") + "|" + b.receipt + "|" + (b.claims || []).length;
      if (blockSeen[sig]) return false;
      blockSeen[sig] = true;
      return true;
    });
    var seenBy = {};
    survivingBlocks.forEach(function (b, bi) {
      (b.claims || []).forEach(function (c) {
        var canon = ledgerClaimId(b, c);
        if (seenBy.hasOwnProperty(canon)) {
          if (seenBy[canon] === bi) return; // 同一ブロック内の再掲は従来どおり無視
          var suffix = "b";
          while (seenBy.hasOwnProperty(canon + suffix)) suffix = String.fromCharCode(suffix.charCodeAt(0) + 1);
          canon = canon + suffix;
        }
        seenBy[canon] = bi;
        var status = "一覧のみ";
        if (cited[canon]) status = "本文で引用";
        else if (uncitedReason[canon] !== undefined) status = "本文未引用（" + (uncitedReason[canon] || "理由記載") + "）";
        /* WPが判っている場合はWP修飾キーを先に引く（裸のsNumが別WPの資料と衝突する
           ことがあるため） */
        var refKey = b.wp ? (b.wp + "-" + c.sNum) : c.sNum;
        var refNum = (refMap && (b.wp ? (refMap[refKey] || refMap[c.sNum]) : refMap[c.sNum])) ||
          (canonRefMap[canonId(refKey)] || canonRefMap[canonId(c.sNum)]) || "";
        var src = (sourcesByWp[b.wp || ""] || {})[c.sNum];
        var srcLabel = src ? [src.publisher, src.title ? "「" + src.title + "」" : ""].filter(Boolean).join("") : "";
        /* 表示IDはledgerClaimId()の結果（WP付き）を使う。従来は"C-"+cNumのままだったため、
           full版でも台帳のID列が本文の C-2-07 と食い違い（一覧のみ判定は正しいのに表示だけ
           C-7 のまま）実走で混乱を招いた（2026-09-03 監査で発見） */
        var grade = evidenceGrade(src, c.excerpt);
        rows.push({ id: canon, claim: c.claim, sNum: c.sNum, refNum: refNum, srcLabel: srcLabel, excerpt: c.excerpt, status: status, grade: grade });
      });
    });
    if (!rows.length) return null;
    var trs = rows.map(function (r) {
      var srcCell = r.refNum ? "[" + escText(r.refNum) + "]" : "S" + escText(r.sNum) + (r.srcLabel ? "（" + escText(r.srcLabel) + "）" : "");
      return "<tr><td>" + escText(r.id) + "</td><td>" + escText(r.claim) + "</td>" +
        "<td>" + srcCell + "</td>" +
        "<td>" + escText(r.excerpt) + "</td><td>" + escText(r.status) + "</td>" +
        '<td class="rr-grade rr-grade-' + escText(r.grade) + '">' + escText(r.grade) + "</td></tr>";
    }).join("");
    var note = fullStyleId
      ? '<p class="note">主張IDがWPをまたぐ形式のため、資料・掲載状況の自動判定は一部の主張でのみ有効です。</p>' : "";
    var gradeNote = '<p class="note">根拠の等級（機械判定の目安）: A＝一次資料・抜粋あり／B＝一次資料（抜粋なし）または直接取材の二次資料・抜粋あり／C＝その他の二次資料・抜粋あり／D＝抜粋なし、または発行日不明。</p>';
    var html2 = '<section class="appendix ledger" id="apx-c"><h2>付録C　主張台帳</h2>' + note + gradeNote +
      '<table><thead><tr><th>ID</th><th>主張</th><th>資料</th><th>原文抜粋</th><th>掲載</th><th>根拠</th></tr></thead>' +
      "<tbody>" + trs + "</tbody></table></section>";
    return { html: html2, rowCount: rows.length };
  }

  /* PART 1 の目次直後に置かれる章計画コメントを読む。
       lite  : <!-- PLAN sec-1: 章題 | C-3,C-7,C-12 -->            （2欄）
       v5.2  : <!-- PLAN sec-1: 章題 | C-1-01,C-1-03 | 約240字 --> （3欄）
     両KITとも「確認済み主張の全IDを、どれかの章にちょうど1回ずつ割り当てる」と定めて
     いるため、このコメントの和集合が「本文に載るはずのID全体」になる。
     実走で「25件が本文にもUNCITEDにも無い」と件数だけ告げたところ、AIは6PART全部を
     出し直しても同じ25件を落としたままだった（どのIDか特定できないため）。期待側の
     ID集合をここから復元し、欠落IDを実名で返せるようにする。
     返り値: { present, entries:[{sec, ids:[]}], all:{id:true}, count, dup:[] } */
  function parsePlan(html) {
    var out = { present: false, entries: [], all: {}, count: 0, dup: [], raw: {} };
    /* script/style内の文字列（JSON-LD等）に紛れた偽PLANを拾わない。コメント自体が
       PLANなので maskRegions（コメントも潰す）は使えず、script/styleだけ潰す */
    var src = String(html || "").replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, function (mm) {
      return new Array(mm.length + 1).join("\n");
    });
    var re = /<!--\s*PLAN\s+sec-([0-9０-９]+)\s*[:：]([\s\S]*?)-->/gi, m;
    var seen = {};
    var entryKeys = {};
    while ((m = re.exec(src))) {
      out.present = true;
      /* digitsOfは全角数字を「削除」してしまう（sec-２ → sec:0）。半角化してから読む */
      var sec = parseInt(toHalfDigits(m[1]), 10);
      /* 欄は「章題 | ID列 [| 約n字]」。ID列の欄は「C-数字 形式のIDが最も多い欄」を選ぶ。
         章題に SiC-MOSFET / PoC-検証 のような「C-」を含む語があっても、数字で始まらない
         トークンはIDとして数えないので取り違えない */
      var fields = String(m[2]).split("|");
      var best = null;
      fields.forEach(function (f) {
        var toks = f.match(/C-\d+(?:-\d+)*/g) || [];
        if (toks.length && (!best || toks.length > best.length)) best = toks;
      });
      if (!best) continue;
      var ids = [];
      best.forEach(function (rawId) {
        var id = canonId(rawId);
        if (ids.indexOf(id) < 0) {
          ids.push(id);
          if (!out.raw[id]) out.raw[id] = rawId; /* 表示用に原文の書式（C-1-02等）を残す */
        }
      });
      /* 同一のPLAN行がもう一度現れた場合（AIが最終PARTでPLANを再掲する・PART 1を
         二重に貼った等）は重複割当ではないので数えない */
      var key = (isNaN(sec) ? 0 : sec) + "|" + ids.join(",");
      if (entryKeys[key]) continue;
      entryKeys[key] = true;
      ids.forEach(function (id) {
        if (seen[id]) { if (out.dup.indexOf(id) < 0) out.dup.push(id); }
        seen[id] = true;
        out.all[id] = true;
      });
      out.entries.push({ sec: isNaN(sec) ? 0 : sec, ids: ids });
    }
    out.count = Object.keys(out.all).length;
    return out;
  }

  /* IDを数値順（C-2-7 は [2,7]）に並べる。文字列ソートだと C-10 が C-2 より前に来て、
     欠落IDの一覧が読みにくくなる */
  function sortIds(list) {
    var key = function (id) {
      return (String(id).match(/\d+/g) || []).map(function (d) { return parseInt(d, 10); });
    };
    return list.slice().sort(function (a, b) {
      var ka = key(a), kb = key(b);
      for (var i = 0; i < Math.max(ka.length, kb.length); i++) {
        var va = ka[i] === undefined ? -1 : ka[i], vb = kb[i] === undefined ? -1 : kb[i];
        if (va !== vb) return va - vb;
      }
      return String(a).localeCompare(String(b));
    });
  }

  /* 表紙メタ（調査者：／調査日：／情報対象期間：）を1項目=1行に分解して取り出す。
     1つの要素に複数項目が詰まっている書き方でも取り違えないよう、ラベルの直前で分割する */
  var COVER_LABELS = ["調査者", "調査日", "情報対象期間", "想定読者", "調査対象"];
  function pushCoverLine(lines, text) {
    var re = new RegExp("(?=(?:" + COVER_LABELS.join("|") + ")\\s*[:：])");
    String(text == null ? "" : text).split(/\n+/).forEach(function (chunk) {
      chunk.split(re).forEach(function (part) { if (part.trim()) lines.push(part.trim()); });
    });
  }
  function coverLines(doc) {
    var lines = [];
    var box = doc.querySelector(".cover-meta") || doc.querySelector(".cover");
    if (!box) return lines;
    Array.prototype.forEach.call(box.querySelectorAll("p, li, div, span, td"), function (el) {
      pushCoverLine(lines, el.textContent);
    });
    pushCoverLine(lines, box.textContent);
    return lines;
  }
  function coverValue(lines, label) {
    var re = new RegExp(label + "\\s*[:：]\\s*(.+)$");
    for (var i = 0; i < lines.length; i++) {
      var m = String(lines[i]).replace(/\s+$/, "").match(re);
      if (m && m[1].trim()) return m[1].trim();
    }
    return "";
  }
  function metaContent(doc, name) {
    var el = doc.querySelector('meta[name="' + name + '"]');
    var v = el ? (el.getAttribute("content") || "") : "";
    return v.trim();
  }

  function runStructureChecks(html, results, info) {
    var doc = parseDoc(html);
    if (!doc || !doc.body) return;
    var v51 = isV51(info);

    /* ネストした<section>を数えないよう直下の章だけを対象にする（参考文献・付録は
       .body-columns の外にあるので、そもそもこの一覧には入らない） */
    var sections = Array.prototype.slice.call(doc.querySelectorAll(".body-columns > section"));
    var sectionLabel = function (sec, i) {
      var h2 = sec.querySelector("h2");
      var t = h2 ? (h2.textContent || "").trim() : "";
      return t || ("第" + (i + 1) + "章");
    };

    // 6. 章ごとの引用有無（調査手法の章は対象外）
    if (!sections.length) {
      addResult(results, !v51, "各章に出典（引用番号）が付いている",
        v51 ? "このKITの形式のレポートですが、章（.body-columns > section）が見つかりません。"
            : "対象となる章（.body-columns > section）が見つかりませんでした。",
        v51 ? { title: "レポートの章構成を読み取れませんでした" }
            : { kind: "na", title: "章が見つからないため、この項目は判定していません" });
    } else {
      var noCite = [];
      sections.forEach(function (sec, i) {
        var h2 = sec.querySelector("h2");
        var h2text = h2 ? (h2.textContent || "") : "";
        if (sec.id === "sec-method" || h2text.indexOf("調査手法") !== -1) return;
        if (sec.querySelectorAll('sup a[href^="#ref-"]').length === 0) noCite.push(sectionLabel(sec, i));
      });
      addResult(results, noCite.length === 0, "各章に出典（引用番号）が付いている",
        noCite.length ? "引用番号が1件も無い章: " + noCite.join("、") + "（調査手法の章は対象外）" : "",
        { title: noCite.length ? "出典が1つも付いていない章があります" : "どの章にも出典が付いています" });
    }

    // 7. 参考文献数と一次資料の有無（付録 .appendix 内の項目は対象外）
    var notInAppendix = function (li) { return !(li.closest && li.closest(".appendix")); };
    var refs = Array.prototype.filter.call(doc.querySelectorAll('li[id^="ref-"]'), notInAppendix);
    var typedRefs = Array.prototype.filter.call(doc.querySelectorAll('li[id^="ref-"][data-source-type]'), notInAppendix);
    if (!refs.length) {
      /* 未知トークン（{{RR:REFERENCES}}等）で参考文献セクションごと欠落した場合、
         この検査は上の検査1と同じ原因を「見つかりません」とだけ言い直す派生の赤に
         なる。検査1が既にPART特定つきで指摘しているのでwarnへ落とす（citeDetail側と
         同じ判断。トークンが無いのに参考文献が本当に無い場合は従来どおり赤のまま） */
      var refsDerivedFromUnknownToken = !!(info && info.tokens && info.tokens.unknown && info.tokens.unknown.length);
      addResult(results, !v51, "参考文献が3件以上あり、一次資料が含まれている",
        v51 ? "このKITの形式のレポートですが、参考文献（section.references 内の li[id^=\"ref-\"]）が見つかりません。"
            : "参考文献リスト（li[id^=\"ref-\"]）が見つかりませんでした。",
        v51
          ? (refsDerivedFromUnknownToken
              ? { kind: "warn", title: "参考文献リストが見つかりません（上の未置換トークンの結果です。そちらを直すとここも解消します）" }
              : { title: "参考文献リストが見つかりません" })
            : { kind: "na", title: "参考文献リストが見つからないため、この項目は判定していません" });
    } else if (!typedRefs.length) {
      addResult(results, !v51, "参考文献が3件以上あり、一次資料が含まれている",
        v51 ? "このKITの形式のレポートですが、data-source-type が参考文献に付与されていません。参考文献は " + refs.length + " 件。"
            : "旧形式のレポートのため一次資料の判定はしません。参考文献は " + refs.length + " 件。",
        v51 ? { title: "参考文献の種類（一次資料かどうか）の情報がありません" }
            : { kind: "na", title: "旧形式のレポートのため、一次資料の有無は判定していません" });
    } else {
      var primaryCount = 0;
      typedRefs.forEach(function (li) {
        if (PRIMARY_TYPES.indexOf((li.getAttribute("data-source-type") || "").trim().toLowerCase()) !== -1) primaryCount++;
      });
      var refOk = refs.length >= 3 && primaryCount >= 1;
      /* 一次資料0件（種類は付与済み・件数は足りる）は、レポートの出し直しでは直せない
         ——SCRIPT Lは整形段階で、新しい資料を調査で足す段階ではない。実走で、この赤を
         AIに送った結果、次のラウンドで二次資料の data-source-type を書き換えて赤を消す
         （＝記録の改竄）方向へ誘導しかけた。一次資料が無いのは調査の記録であって
         レポートの不備ではないため、黄色（warn。AIに送らない）で知らせるだけにする。
         refs<3 は従来どおり赤（参考文献セクションの出し忘れ等、整形段階で直せる欠陥が主因） */
      var fewRefs = refs.length < 3;
      addResult(results, refOk, "参考文献が3件以上あり、一次資料が含まれている",
        "参考文献 " + refs.length + " 件・一次資料 " + primaryCount + " 件" +
        (refOk ? "" : fewRefs
          ? "（3件以上かつ一次資料1件以上が必要です。プレスリリース・公式サイト・IR資料・官公庁・論文・特許のいずれかを含めてください）"
          : "。一次資料（プレスリリース・公式サイト・IR資料・官公庁・論文・特許）が見つかりませんでした。調査で一次資料に当たらなかった場合はそのままで構いません。実際の資料種類と異なる data-source-type に書き換えて合格させないでください（それは記録不備です）"),
        { kind: refOk ? "ok" : (fewRefs ? "action" : "warn"),
          title: refOk ? "参考文献の件数と一次資料の条件を満たしています"
               : fewRefs ? "参考文献が足りません（参考文献 " + refs.length + " 件・一次資料 " + primaryCount + " 件）"
               : "一次資料（公式発表・官公庁資料など）が入っていません。そのままでも完成できます（参考文献 " + refs.length + " 件）",
          next: refOk ? "" : fewRefs ? "AIに「不備をコピー」の文面を送る" : "" });
    }

    // 8. 参考文献URLの重複
    var refLinks = doc.querySelectorAll('li[id^="ref-"] a[href]');
    if (!refLinks.length) {
      addResult(results, true, "参考文献のURLが重複していない", "参考文献のリンクが見つかりませんでした。",
        { kind: "na", title: "参考文献のリンクが無いため、この項目は判定していません" });
    } else {
      var seen = {}, dups = [];
      Array.prototype.forEach.call(refLinks, function (a) {
        var key = normalizeRefUrl(a.getAttribute("href"));
        if (!key) return;
        if (seen[key]) { if (dups.indexOf(key) === -1) dups.push(key); }
        else seen[key] = true;
      });
      addResult(results, dups.length === 0, "参考文献のURLが重複していない",
        dups.length ? "同じURLが複数の項目にあります: " + dups.slice(0, 5).join(", ") + "（末尾スラッシュ・www・utm_パラメータの違いは同一として判定）" : "",
        { kind: dups.length === 0 ? "ok" : "warn",
          title: dups.length ? "同じ資料が参考文献に重複して載っています" : "参考文献の重複はありません" });
    }

    // 9. 引用に主張の紐づけ（data-claim）があるか
    var sups = doc.querySelectorAll('sup a[href^="#ref-"]');
    if (!sups.length) {
      addResult(results, !v51, "引用に主張（data-claim）が紐づいている",
        v51 ? "このKITの形式のレポートですが、引用（sup a[href^=\"#ref-\"]）が見つかりません。"
            : "引用番号が見つかりませんでした。",
        v51 ? { title: "本文に引用が1つも見つかりません" }
            : { kind: "na", title: "引用が見つからないため、この項目は判定していません" });
    } else {
      var lacking = 0;
      Array.prototype.forEach.call(sups, function (a) { if (!a.getAttribute("data-claim")) lacking++; });
      if (lacking === sups.length) {
        addResult(results, !v51, "引用に主張（data-claim）が紐づいている",
          v51 ? "このKITの形式のレポートですが、data-claim属性がどの引用にも付与されていません。引用は " + sups.length + " 件。"
              : "旧形式のレポートのため判定しません。引用は " + sups.length + " 件。",
          v51 ? { title: "引用と調査記録を結びつける情報が抜けています" }
              : { kind: "na", title: "旧形式のレポートのため、この項目は判定していません" });
      } else {
        addResult(results, lacking === 0, "引用に主張（data-claim）が紐づいている",
          lacking ? "data-claimが無い引用: " + lacking + " 件 / 全 " + sups.length + " 件" : "",
          { title: lacking ? "一部の引用に、調査記録との対応情報が付いていません（" + lacking + "件／全" + sups.length + "件）"
                           : "すべての引用に調査記録との対応情報が付いています" });
      }
    }

    // 10. 各章の見出し直後がキーメッセージか
    if (!sections.length) {
      addResult(results, !v51, "各章の見出し直後にキーメッセージがある",
        v51 ? "このKITの形式のレポートですが、章（.body-columns > section）が見つかりません。"
            : "対象となる章が見つかりませんでした。",
        v51 ? { title: "レポートの章構成を読み取れませんでした" }
            : { kind: "na", title: "章が見つからないため、この項目は判定していません" });
    } else {
      var noKey = [];
      sections.forEach(function (sec, i) {
        var h2 = sec.querySelector("h2");
        if (!h2) return;
        var next = h2.nextElementSibling;
        if (!next || !next.classList || !next.classList.contains("key-message")) noKey.push(sectionLabel(sec, i));
      });
      addResult(results, noKey.length === 0, "各章の見出し直後にキーメッセージがある",
        noKey.length ? "見出しの直後が .key-message でない章: " + noKey.join("、") : "",
        { title: noKey.length ? "冒頭に要点（キーメッセージ）が無い章があります" : "各章の冒頭に要点があります" });
    }

    // 11. メタ情報と表紙の記載の一致
    var lines = coverLines(doc);
    var pairs = [
      { label: "調査日", meta: metaContent(doc, "DC.date"), cover: coverValue(lines, "調査日"), digits: true },
      { label: "情報対象期間", meta: metaContent(doc, "DC.coverage"), cover: coverValue(lines, "情報対象期間"), digits: true },
      { label: "調査者", meta: metaContent(doc, "author"), cover: coverValue(lines, "調査者"), digits: false }
    ];
    var metaProblems = [];
    var metaChecked = 0;
    pairs.forEach(function (p) {
      if (!p.meta && !p.cover) return;               // 両方無ければ対象外
      metaChecked++;
      if (!p.meta || !p.cover) {
        metaProblems.push(p.label + "：" + (p.meta ? "表紙の記載がありません" : "metaタグがありません"));
        return;
      }
      var same;
      if (p.digits) {
        var km = dateKeys(p.meta), kc = dateKeys(p.cover);
        same = (km && kc) ? (km === kc) : (digitsOf(p.meta) === digitsOf(p.cover));
      } else {
        same = (p.meta === p.cover);
      }
      if (!same) metaProblems.push(p.label + "：meta「" + p.meta + "」と表紙「" + p.cover + "」が一致しません");
    });
    addResult(results, metaProblems.length === 0, "メタ情報（調査日・情報対象期間・調査者）と表紙の記載が一致している",
      metaProblems.length ? metaProblems.join(" ／ ") : (metaChecked ? "" : "対象のメタタグ・表紙の記載がどちらもありません。"),
      metaProblems.length ? { title: "表紙の日付・調査者と内部情報がずれています" }
        : (metaChecked ? { title: "表紙の記載と内部情報が一致しています" }
                       : { kind: "na", title: "表紙の記載が無いため、この項目は判定していません" }));

    // 12. キーワードのmeta
    var kwEl = doc.querySelector('meta[name="keywords"]');
    if (!kwEl) {
      addResult(results, true, "キーワード（meta name=\"keywords\"）が入っている", "meta name=\"keywords\" がありません。",
        { kind: "na", title: "キーワード欄が無いため、この項目は判定していません" });
    } else {
      var kw = (kwEl.getAttribute("content") || "").trim();
      addResult(results, kw !== "", "キーワード（meta name=\"keywords\"）が入っている", kw ? "" : "meta name=\"keywords\" の内容が空です。",
        { kind: kw !== "" ? "ok" : "warn",
          title: kw ? "検索用キーワードが入っています" : "検索用キーワードが空です" });
    }

    // 13. 確認済み事実の引用カバー率
    //     data-claim は「C-012 C-044」のように複数IDを持てるため、空白・カンマで分割して
    //     C- で始まるトークンを数える（合成結論のX-IDは分母に入らないので数えない）
    //     v5.1: <!-- UNCITED: C-2-07(理由); … --> がある場合は「理由付きの未引用」を加えて
    //     引用＋理由付き未引用 ≥ 確認済み かつ 引用率 ≥ 80% を合格条件にする（UNCITED無しなら従来どおり）
    var ccEl = doc.querySelector('meta[name="rr:confirmed-count"]');
    if (!ccEl) {
      addResult(results, !v51, "確認済み事実のうち8割以上が本文で引用されている",
        v51 ? "このKITの形式のレポートですが、meta name=\"rr:confirmed-count\" がありません。"
            : "meta name=\"rr:confirmed-count\" が無いため判定できません。",
        v51 ? { title: "調査で確認した件数の記載が無く、引用の網羅を判定できません" }
            : { kind: "na", title: "旧形式のレポートのため、この項目は判定していません" });
    } else {
      var total = parseInt(digitsOf(ccEl.getAttribute("content")), 10);
      var claims = citedClaimSet(doc);
      var claimCount = Object.keys(claims).length;
      if (!total || isNaN(total)) {
        addResult(results, !v51, "確認済み事実のうち8割以上が本文で引用されている",
          v51 ? "このKITの形式のレポートですが、rr:confirmed-count の値を読み取れません。"
              : "rr:confirmed-count の値を読み取れませんでした。",
          v51 ? { title: "調査で確認した件数を読み取れませんでした" }
              : { kind: "na", title: "確認済み件数を読み取れないため、この項目は判定していません" });
      } else {
        var ratio = claimCount / total;
        var unc = parseUncited(html);
        var explained = 0, noReason = [], alreadyCited = [];
        if (unc.present) {
          unc.entries.forEach(function (e) {
            if (claims[e.id]) { alreadyCited.push(e.id); return; }
            if (e.reason) explained++; else noReason.push(e.id);
          });
        }
        var covTitle = function (okCov) {
          return okCov ? "調査で確認した事実が本文に反映されています"
                       : "調査で確認した事実の一部が本文に反映されていません（" + claimCount + "/" + total + "件）";
        };
        /* UNCITEDの上限は確認済み件数の5%（KIT §5.2）。上限を超える、または引用率が
           半分を割る場合、「UNCITED行に理由を足す」は規則上そもそも許されない解決である。
           実走ではAIがこの一文を根拠に32件を理由付きUNCITEDへ退避したため、
           remedyをgapの大きさで切り替え、必ず「本文へ組み込む」を先頭に置く */
        var uncCap = Math.max(1, Math.floor(total * 0.05));
        if (!unc.present) {
          addResult(results, ratio >= 0.8, "確認済み事実のうち8割以上が本文で引用されている",
            (ratio >= 0.8 ? "" :
              "未引用の確認済み主張を本文に組み込んで（該当する章の文に [[資料ID|C-ID]] を付けて）、該当PARTを出し直してください。" +
              "UNCITED行に理由を足して済ませてはいけません（UNCITEDは確認済み " + total + " 件の5%＝" + uncCap + " 件までが上限です）。") +
            "引用された主張 " + claimCount + " 件 / 確認済み " + total + " 件（" + Math.round(ratio * 100) + "%）",
            { title: covTitle(ratio >= 0.8),
              next: ratio >= 0.8 ? "" : "AIに「不備をコピー」の文面を送り、未引用の主張を本文へ組み込ませる" });
        } else {
          var covered = claimCount + explained >= total;
          var ok13 = ratio >= 0.8 && covered;
          var missing = total - claimCount - explained;
          /* 「理由を足す」で足りるのは、5%上限の内側に収まり、かつ引用率が既に近い場合だけ */
          var hardGap = ratio < 0.5 || (explained + Math.max(missing, 0)) > uncCap;
          var d13 = "";
          if (!ok13) {
            if (hardGap) {
              var plan13 = parsePlan(html);
              d13 = "本文に組み込む（引用する）ことが必要です。未引用の確認済み主張を該当する章の文へ書き入れ、その文に [[資料ID|C-ID]] を付けて、該当PARTを出し直してください。" +
                "UNCITED行に理由を追記して済ませてはいけません——UNCITEDは確認済み " + total + " 件の5%＝" + uncCap + " 件までが上限で、現在の未引用 " + (explained + Math.max(missing, 0)) + " 件はこれを大きく超えています。" +
                "章の割当（PLANコメント）に戻り、割り当てたClaimを全件本文で使ってください。" +
                (plan13.present && plan13.count === total
                  ? "欠けている主張IDは「確認済み件数（rr:confirmed-count）と本文の主張ID数が一致している」の行に全件挙げてあります。"
                  : "PART 1にPLANコメントが無い（または割当件数が確認済み件数と合っていない）ため、欠けているIDの列挙は出せません。この会話の確認済みID一覧と本文で引用したIDを突き合わせてください。");
            } else {
              d13 = "未引用の確認済み主張を本文へ組み込むか（推奨）、5%以内に収まる範囲でUNCITED行に理由（集約／重要度低／scope外）を追記して、該当PARTを出し直してください。";
            }
          }
          d13 += "引用 " + claimCount + " 件＋理由付き未引用 " + explained + " 件 / 確認済み " + total + " 件（引用率 " + Math.round(ratio * 100) + "%、合格は80%以上）";
          if (missing > 0) d13 += "。理由のない未引用が " + missing + " 件あります";
          if (noReason.length) d13 += "。理由の無いUNCITED: " + noReason.slice(0, 8).join(", ");
          if (alreadyCited.length) d13 += "。本文で引用済みなのにUNCITEDにもあるID（UNCITED行から削ってください。二重計上になります）: " + alreadyCited.slice(0, 8).join(", ");
          addResult(results, ok13, "確認済み事実のうち8割以上が本文で引用されている", d13,
            { title: covTitle(ok13),
              next: ok13 ? "" : (hardGap ? "AIに「不備をコピー」の文面を送り、未引用の主張を本文へ組み込ませる"
                                         : "AIに「不備をコピー」の文面を送る") });
        }
        /* 以下2行はv5.1+文書だけの追加判定（旧テンプレートでは行数を増やさない） */
        if (v51 && unc.unparsed && unc.unparsed.length) {
          addResult(results, true, "UNCITED行の一部を解析できませんでした（情報）",
            "解析できなかった内容: " + unc.unparsed.slice(0, 5).join(" ／ "),
            { kind: "warn", title: "本文で使わなかった事実のメモを一部読み取れませんでした" });
        }
        if (v51) {
          // 新規: UNCITED（理由付き未引用）の割合は確認済み事実の5%以内
          var uncitedRatio = total ? explained / total : 0;
          var capN = Math.max(1, Math.floor(total * 0.05));
          var capOk = explained <= capN;
          addResult(results, capOk, "UNCITEDの割合が確認済み事実の5%以内である",
            (capOk ? "" :
              "超過分を本文へ組み込んで（該当する章の文に [[資料ID|C-ID]] を付けて）、該当PARTを出し直してください。" +
              "UNCITEDに残してよいのは " + capN + " 件までで、理由を追記しても上限は緩みません。統合したものは 集約→C-x の形で統合先IDを明記してください。") +
            "理由付き未引用 " + explained + " 件 / 確認済み " + total + " 件（" + (Math.round(uncitedRatio * 10000) / 100) + "%、上限は5%＝" + capN + " 件）",
            { kind: capOk ? "ok" : "action",
              next: capOk ? "" : "AIに「不備をコピー」の文面を送り、超過分を本文へ組み込ませる",
              title: capOk ? "本文に載せなかった確認事実は少数に収まっています"
                           : "本文に載せなかった確認事実が多すぎます（" + explained + "件／上限 " + capN + "件）" });
        }
      }
    }
  }


  /* =====================================================================
     v5.1: PART結合・CSS付与・参考文献の採番付け直し・集計トークン置換・追加判定
     ===================================================================== */

  /* {{RR:*}} の正式名（別名は fillTokens 内で解決）。check1の「計算できないトークン」
     メッセージにもこの一覧をそのまま使うので、実装済みトークンは必ずここに含める */
  var TOKEN_NAMES = ["SOURCE_COUNT", "PRIMARY_COUNT", "PRIMARY_RATIO", "CONSULTED_COUNT", "PUBLISHER_COUNT",
    "SOURCE_CATEGORY_COUNT", "CLAIM_COUNT", "CITATION_COUNT", "UNCONFIRMED_COUNT", "TARGET_COUNT", "PERIOD",
    "CONFIRMED_COUNT", "APPENDIX_SOURCE_COUNT", "COVERAGE_CARD", "COVER_STATS"];
  var TOKEN_ALIASES = { REF_COUNT: "SOURCE_COUNT", CITED_SOURCE_COUNT: "SOURCE_COUNT", TOTAL_SOURCE_COUNT: "CONSULTED_COUNT",
    CATEGORY_COUNT: "SOURCE_CATEGORY_COUNT", APPENDIX_SOURCE_COUNT: "APPENDIX_SOURCE_COUNT" };

  var RE_MARKER = /<!--\s*RR-(PART|END)\s*([0-9０-９]+)\s*[\/／]\s*([0-9０-９]+)\s*-->/gi;
  function canonMarkers(s) {
    return s.replace(RE_MARKER, function (all, kind, k, n) {
      /* 先頭ゼロも落とす（AIが 01/02 と書くことがある。parseParts は k を整数として
         RR-END の正規表現を組むため、ここで正規化しないと終端が永久に見つからない） */
      return "<!-- RR-" + kind.toUpperCase() + " " + String(parseInt(toHalfDigits(k), 10)) +
        "/" + String(parseInt(toHalfDigits(n), 10)) + " -->";
    });
  }
  function stripTrailingFence(s) { return s.replace(/\r?\n?[ \t]*```[ \t]*\s*$/, ""); }

  /* RR-END が無いPART本文から、貼り付け末尾に混入した素のフェンス行・チャットの説明文
     （<で始まらない日本語の行）を切り落とす。見つからなければそのまま返す */
  var RE_JP_TEXT_LINE = /[぀-ヿ一-鿿]/;
  function softCutBody(body) {
    var lines = String(body || "").split("\n");
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) continue;
      if (/^```/.test(t)) return lines.slice(0, i).join("\n");
      /* 2026-09-03(完成前の最終洗い出し・C2): R|で始まる参考文献行は日本語のタイトルを
         含むため、RE_JP_TEXT_LINEに引っかかって「地の文」と誤判定され、RR-ENDが無い
         参考文献のみのPARTがまるごと切り落とされていた。R|行はここでは無視する */
      if (/^[ \t　]*R\|/.test(t)) continue;
      if (t.charAt(0) !== "<" && RE_JP_TEXT_LINE.test(t)) return lines.slice(0, i).join("\n");
    }
    return body;
  }

  /* 貼り付け内容から <!-- RR-PART k/n --> … <!-- RR-END k/n --> の区間を切り出す。
     マーカーが無ければ legacy（従来の完成HTML経路） */
  /* KITの本文PART上限は6（がっつりは8）。ただし2026-09-02からフル版は末尾（調査手法・
     参考文献・付録・免責）の分割PARTをこの上限に含めない設計になり、参考文献が
     多い調査では本文8＋末尾4〜5で13を超えうる。ここでの上限はAIの誤記（マーカーの
     桁を打ち間違える等）による異常な巨大nを弾くための安全弁なので、その設計変更後の
     現実的な最大値に余裕を持たせて16とする */
  var MAX_PARTS = 16;
  function parseParts(raw) {
    var s = String(raw || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
    s = canonMarkers(s);
    var markers = [];
    var re = /<!-- RR-PART (\d+)\/(\d+) -->/g, m;
    while ((m = re.exec(s))) markers.push({ k: parseInt(m[1], 10), n: parseInt(m[2], 10), start: m.index, end: m.index + m[0].length });
    var overCap = markers.some(function (mk) { return mk.n > MAX_PARTS || mk.n < 1; });
    if (overCap) {
      /* nが上限を超えたマーカーは無視し、レガシー（マーカー無し完成HTML）として扱う。
         マーカー文字列自体も取り除いておかないと、後段のcheck 5（</html>まで完結）等が
         本文中に残ったコメントに引きずられる */
      var stripped2 = s.replace(/<!-- RR-(?:PART|END) \d+\/\d+ -->/g, "");
      return { legacy: true, norm: normalizeInput(stripped2), parts: [], maxN: 0,
        warnings: ["PARTの総数が上限（" + MAX_PARTS + "）を超えているマーカーがあります。このマーカーは無視しました"] };
    }
    if (!markers.length) return { legacy: true, norm: normalizeInput(raw), parts: [], maxN: 0, warnings: [] };
    var parts = [], warnings = [], maxN = 0, nSet = {};
    markers.forEach(function (mk, i) {
      var limit = i + 1 < markers.length ? markers[i + 1].start : s.length;
      var segment = s.slice(mk.end, limit);
      var endRe = new RegExp("<!-- RR-END " + mk.k + "\\/(\\d+) -->");
      var em = endRe.exec(segment);
      var body, hasEnd = false, endedByNextMarker = false;
      if (em) { body = segment.slice(0, em.index); hasEnd = true; }
      else {
        body = softCutBody(segment);
        endedByNextMarker = i + 1 < markers.length;
      }
      body = stripTrailingFence(body.replace(/\s+$/, "")).replace(/^\s*\n/, "");
      parts.push({ k: mk.k, n: mk.n, body: body, hasEnd: hasEnd, endedByNextMarker: endedByNextMarker });
      nSet[mk.n] = true;
      if (mk.n > maxN) maxN = mk.n;
    });
    var ns = Object.keys(nSet);
    if (ns.length > 1) warnings.push("PARTの総数が食い違っています（" + ns.join(" と ") + "）。大きい方（" + maxN + "）を採用します");
    parts.forEach(function (p) { if (p.k > maxN || p.k < 1) warnings.push("PART " + p.k + " は総数 " + maxN + " の範囲外です"); });
    return { legacy: false, parts: parts, maxN: maxN, warnings: warnings };
  }

  /* 受領状況。store = { n, parts: { k: { body, hasEnd, endedByNextMarker } } }
     soft-END（RR-ENDが無いまま本文が続いていた）は「次のPARTマーカーへ続き、かつ
     本文の末尾が閉じタグ（</section>|</div>|</html>）で終わっている」場合のみ受理する。
     閉じタグで終わっていなければ、次マーカーが続いていても truncated（途中で切れている） */
  var RE_CLOSED_TAG_END = /<\/(?:section|div|html)>\s*$/i;
  function partStatus(store) {
    var n = (store && store.n) || 0;
    var parts = (store && store.parts) || {};
    var received = Object.keys(parts).map(function (k) { return parseInt(k, 10); }).filter(function (k) { return !isNaN(k); }).sort(function (a, b) { return a - b; });
    var missing = [], truncated = [], softEnd = [], outOfRange = [];
    for (var i = 1; i <= n; i++) if (!parts[i]) missing.push(i);
    received.forEach(function (k) {
      var p = parts[k];
      if (k > n || k < 1) { outOfRange.push(k); return; }
      if (p.hasEnd) return;
      var trimmedBody = String(p.body || "").trim();
      var lastOk = (k === n) && /<\/html>\s*$/i.test(trimmedBody);
      var softOk = p.endedByNextMarker && RE_CLOSED_TAG_END.test(trimmedBody);
      if (softOk || lastOk) softEnd.push(k); else truncated.push(k);
    });
    var complete = n > 0 && missing.length === 0 && truncated.length === 0 && outOfRange.length === 0;
    var msgs = [];
    var inRange = received.filter(function (k) { return k >= 1 && k <= n; });
    if (n > 0 && inRange.length) msgs.push("PART " + inRange.join("、") + " を受け取りました（全" + n + "個）");
    if (missing.length) msgs.push("残り: PART " + missing.join("、") + "。AIチャットに「次」と返信し、届いたら貼り付けてください");
    truncated.forEach(function (k) {
      msgs.push("PART " + k + " が途中で切れています。AIに「PART " + k + " を出し直して」と送り、届いたものを貼り付けてください");
    });
    if (outOfRange.length) msgs.push("PART番号が総数と合いません（PART " + outOfRange.join("、") + "、全" + n + "個）。「クリア」してから貼り直してください");
    if (complete) msgs.push("全PARTがそろいました。結合して検証します");
    return { n: n, received: received, missing: missing, truncated: truncated, softEnd: softEnd, outOfRange: outOfRange, complete: complete, message: msgs.join("。") };
  }

  function assembleParts(store) {
    var parts = (store && store.parts) || {};
    var ks = Object.keys(parts).map(function (k) { return parseInt(k, 10); }).sort(function (a, b) { return a - b; });
    var joined = ks.map(function (k) { return parts[k].body; }).join("\n");
    return normalizeInput(joined).html;
  }

  /* ---- PARTセットの取り違え防止（レポート同一性・n変更） ----
     partStoreは k だけをキーにした辞書で「どのレポートか」を持たないため、AIがPARTを
     再出力した際にnが変わったり、別レポートのPARTが同じタブに貼られたりすると、
     古いPARTが残ったまま結合されてしまう（本文2重・参考文献2重）。以下はその判定 */

  function normalizeIdText(s) { return String(s == null ? "" : s).replace(/\s+/g, "").trim(); }

  /* IDの数字区間の先頭ゼロを落として突合用に揃える（C-07≡C-7、C-1-07≡C-1-7、資料 01-07≡1-7）。
     AIがPARTごとに0詰めを揺らすと、同じ主張が別IDに数えられて件数照合が合わなくなり、
     参考文献も未解決参照になるため。data-claim属性の値そのものは書き換えない */
  function canonId(id) {
    return String(id == null ? "" : id).trim().replace(/\d+/g, function (d) { return String(parseInt(d, 10)); });
  }

  /* PART本文から「どのレポートか」を取り出す。§19.2の構造上、head・表紙を含む
     PART 1だけが値を持ち、章のみの中間PART・最終PARTは空になる。
     head途中で切れたPART 1でも取れる（headが先頭に来るため） */
  function partIdentity(body) {
    var doc = parseDoc(String(body || ""));
    if (!doc) return { rid: "", title: "" };
    var rid = normalizeIdText(metaContent(doc, "rr:research-id"));
    var titleEl = doc.querySelector("title");
    var h1 = doc.querySelector("h1");
    var title = normalizeIdText(titleEl ? titleEl.textContent : (h1 ? h1.textContent : ""));
    return { rid: rid, title: title };
  }

  /* 貼り付けられたPART群のうち、身元を持つもの（実質PART 1）から拾う */
  function partsIdentity(parts) {
    var id = { rid: "", title: "" };
    (parts || []).forEach(function (p) {
      if (id.rid || id.title) return;
      var pid = partIdentity(p.body);
      if (pid.rid || pid.title) id = pid;
    });
    return id;
  }

  /* 比較できる材料が1つでも一致すれば "same"、すべて食い違えば "different"、
     材料が無ければ "unknown"。誤って破棄する害の方が大きいので保守的に判定する */
  function identityMatch(a, b) {
    a = a || {}; b = b || {};
    var comparable = false, anySame = false;
    if (a.rid && b.rid) { comparable = true; if (a.rid === b.rid) anySame = true; }
    if (a.title && b.title) { comparable = true; if (a.title === b.title) anySame = true; }
    if (!comparable) return "unknown";
    return anySame ? "same" : "different";
  }

  /* 受領済みストアに新しいPART群を受け入れる前の判定。storeは書き換えない（純関数）。
     mode: "merge"（通常の受領・差し替え） | "newCount"（nが変わった） | "newReport"（別レポート） */
  function partSetPlan(store, parsed) {
    var sn = (store && store.n) || 0;
    var sid = { rid: (store && store.rid) || "", title: (store && store.title) || "" };
    var filled = (store && store.parts) || {};
    var pn = parsed.maxN || 0;
    var pid = partsIdentity(parsed.parts);
    var match = identityMatch(sid, pid);
    var nextId = { rid: pid.rid || sid.rid, title: pid.title || sid.title };
    var hasFilled = Object.keys(filled).length > 0;
    var kmin = Infinity;
    parsed.parts.forEach(function (p) { if (p.k < kmin) kmin = p.k; });
    if (!isFinite(kmin)) kmin = 1;

    if (!hasFilled) {
      return { mode: "merge", n: pn, id: nextId, dropped: [], unverified: [], prevN: sn, prevTitle: sid.title, kmin: kmin, match: match };
    }
    if (match === "different") {
      var droppedAll = Object.keys(filled).map(function (k) { return parseInt(k, 10); });
      return { mode: "newReport", n: pn, id: pid, dropped: droppedAll, unverified: [], prevN: sn, prevTitle: sid.title, kmin: kmin, match: match };
    }
    if (pn > sn) {
      var dropInc = Object.keys(filled).map(function (k) { return parseInt(k, 10); })
        .filter(function (k) { return k >= kmin || k > pn; });
      return { mode: "newCount", n: pn, id: nextId, dropped: dropInc, unverified: [], prevN: sn, prevTitle: sid.title, kmin: kmin, match: match };
    }
    if (pn < sn && pn > 0) {
      var dropDec = Object.keys(filled).map(function (k) { return parseInt(k, 10); });
      return { mode: "newCount", n: pn, id: nextId, dropped: dropDec, unverified: [], prevN: sn, prevTitle: sid.title, kmin: kmin, match: match };
    }
    /* pn === sn（またはpn===0＝今回身元不明のみ）: 通常の受領・差し替え。
       身元が今回初めて判明した場合は、既存slotを「同じレポートのものとして扱う」注記だけ出す */
    var unverified = [];
    if (!sid.rid && !sid.title && (pid.rid || pid.title)) {
      unverified = Object.keys(filled).map(function (k) { return parseInt(k, 10); })
        .filter(function (k) { return parsed.parts.every(function (p) { return p.k !== k; }); });
    }
    return { mode: "merge", n: pn || sn, id: nextId, dropped: [], unverified: unverified, prevN: sn, prevTitle: sid.title, kmin: kmin, match: match };
  }

  /* head内で許可されない部品。ビューアが挿入する<style>とJSON-LD<script>だけを除く。
     R3（autoRepair）とhead側の許可外チェックの両方がこの定数を共有する（片方だけ
     禁じても、もう一方が直せない赤を残してしまうため） */
  /* meta[http-equiv="Content-Type"]は除外する。refresh・CSP上書き等の悪用経路とは違い、
     文字コード宣言はダウンロードしたHTMLをfile://で開いたときの文字化け防止に必要で、
     ここしか宣言場所が無いことがある（meta charsetを別途持たない旧テンプレ等） */
  var HEAD_FORBIDDEN_SEL = 'base, link, noscript, template, script:not([type="application/ld+json"]), meta[http-equiv]:not([http-equiv="Content-Type" i])';

  /* <style> が無ければ </head> の直前にCSSを挿入する（文字列操作。DOM再直列化はしない） */
  function ensureStyle(html, css) {
    var s = String(html || "");
    var doc = parseDoc(s);
    /* <body> 側の <style> は R3（autoRepair）が削除するので「既にCSSがある」とみなさない。
       文書全体を見ていた頃は、body内に<style>があるとCSSを入れずR3がそれを消し、
       完全に無装飾のレポートになっていた */
    var hadStyle = !!(doc && doc.head && doc.head.querySelector("style"));
    if (hadStyle) return { html: s, injected: false, hadStyle: true, failed: false };
    var block = "<style>\n" + String(css || "") + "\n</style>\n";
    var i = s.search(/<\/head\s*>/i);
    if (i >= 0) return { html: s.slice(0, i) + block + s.slice(i), injected: true, hadStyle: false, failed: false };
    var j = s.search(/<body\b/i);
    if (j >= 0) return { html: s.slice(0, j) + block + s.slice(j), injected: true, hadStyle: false, failed: false };
    return { html: s, injected: false, hadStyle: false, failed: true };
  }

  /* 参考文献番号を本文の出現順に 1..N へ付け直し、参考文献の <ol> を同じ順に並べ替える。
     本文で引用されていない参考文献は、引用済みの後ろに元の順で残し N+1.. を振る。
     data-claim は触らない。変更が無ければ元の文字列をそのまま返す */
  /* ---- 圧縮記法の展開 ----
     AIがレポートを書く量を減らすため、引用と参考文献は短い記法で書かせ、
     ここで従来と同一のHTMLへ展開する（表示・PDF・検査・自動修復はすべて展開後に動く）。
       引用   [[1-7|C-1-12]]  並列は ; 区切り → <sup><a href="#ref-…" data-claim="…">[…]</a>…</sup>
       参考文献 R|1-7|gv|書誌テキスト|URL      → <li id="ref-1-7" data-source-type="gv"><a …>…</a></li>
     従来のフルHTML記法で書かれた文書には該当パターンが無いため素通しになる（後方互換） */
  var RE_COMPACT_CITE = /\[\[([^\[\]\n]{1,400})\]\]/g;
  var RE_COMPACT_REF = /^[ \t　]*R\|(.+)$/gm;
  var RE_MASK_REGION = /<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi;
  /* タグの中身（属性値を含む）だけを追加でマスクする版。[[…]] や R|… が正当に現れる
     のは要素の本文（>と<の間）だけで、タグの内側（<…>）に来るのは
     title="[[1|C-1]]" のような貼り付け事故だけ。マスクしないと展開結果が属性値の
     中に生HTMLとして混入しタグごと壊れる（"を閉じてしまう）。
     ※付録A範囲の検出（reApx）は<section>タグ自体を探すため、この版は使わず
     従来のmaskRegionsを使う——両者を混同すると付録Aが二度と見つからなくなる */
  var RE_TAG_ONLY = /<[^>]*>/g;

  /* script/style/HTMLコメントの中身を同じ長さの改行で埋め、圧縮記法の正規表現が
     JSON-LDやコメント内の [[…]]・R|行を誤って展開しないようにする。改行埋めなのは
     両正規表現とも \n をまたげないため、原文とマスク後文字列でオフセットが必ず一致する */
  function maskRegions(s) {
    return s.replace(RE_MASK_REGION, function (m) { return new Array(m.length + 1).join("\n"); });
  }
  /* maskRegions に加えてタグの中身も潰す（付録A検出には使わない。上のRE_TAG_ONLY参照） */
  function maskRegionsAndTags(s) {
    return maskRegions(s).replace(RE_TAG_ONLY, function (m) { return new Array(m.length + 1).join("\n"); });
  }
  /* マスク済み文字列上でreを実行し、マッチ範囲だけ原文から切り出してfnへ渡す
     （置換結果はマスクではなく原文の内容から作る） */
  function replaceUnmasked(orig, masked, re, fn) {
    var out = "", last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(masked))) {
      out += orig.slice(last, m.index) + fn.apply(null, m.concat([m.index]));
      last = m.index + m[0].length;
    }
    return out + orig.slice(last);
  }

  function expandCompact(html) {
    var s = String(html || "");
    var out = { html: s, cites: 0, refs: 0, changed: false };

    s = replaceUnmasked(s, maskRegionsAndTags(s), RE_COMPACT_CITE, function (all, inner) {
      var items = inner.split(";");
      var as = [], left = [];
      /* 2026-09-03(7回目・初実走FB): 同じ資料IDが1つの[[…]]内で繰り返される
         （例: [[1|C-1;2|C-2;2|C-3]]）と、実走のPDFで"[1][2][2]"のような連続番号に
         なった。同じridは<a>を増やさず既存アンカーのdata-claimへトークンを連結する */
      var byRid = {};
      for (var i = 0; i < items.length; i++) {
        var f = items[i].split("|");
        var rid = (f[0] || "").trim();
        var claim = (f.length > 1 ? f[1] : "").trim();
        /* ref-IDらしくなければ展開しない（本文中の [[…]] を誤変換しないため）。
           並列引用の1件だけが書式違いのときは、正しい分は展開し、誤った分だけ
           元の記法のまま残す（チェック19が知らせる） */
        if (!/^[0-9A-Za-z][0-9A-Za-z-]*$/.test(rid)) { left.push(items[i]); continue; }
        rid = canonId(rid);
        if (byRid[rid]) {
          if (claim) byRid[rid].claims.push(claim);
        } else {
          var entry = { claims: claim ? [claim] : [] };
          byRid[rid] = entry;
          as.push({ rid: rid, entry: entry });
        }
      }
      if (!as.length) return all;
      out.cites += as.length;
      var anchors = as.map(function (a) {
        var claimAttr = a.entry.claims.length ? ' data-claim="' + escText(a.entry.claims.join(" ")) + '"' : "";
        return '<a href="#ref-' + a.rid + '"' + claimAttr + ">[" + a.rid + "]</a>";
      });
      return "<sup>" + anchors.join("") + "</sup>" + (left.length ? "[[" + left.join(";") + "]]" : "");
    });

    /* 付録A（参照資料一覧）の中で R| が使われた場合は id を付けない。
       KIT §19.2 の項目8が「付録Aに id="ref-" は付けない」と定めているため、
       AIが参考文献と同じ記法を使っても仕様どおりの出力になるようにする */
    var apxRanges = [];
    var reApx = /<section\b[^>]*class="[^"]*\bappendix\b[^"]*"[^>]*>[\s\S]*?<\/section>/gi;
    var am;
    var maskedForApx = maskRegions(s);
    while ((am = reApx.exec(maskedForApx))) apxRanges.push([am.index, am.index + am[0].length]);
    function inAppendix(i) {
      for (var k = 0; k < apxRanges.length; k++) if (i >= apxRanges[k][0] && i < apxRanges[k][1]) return true;
      return false;
    }

    /* R|行はタグ内マスクを使わない（意図的）。RE_COMPACT_REFは行単位（^…$）のため、
       書誌テキストに正当に含まれる生の <山括弧> をタグとしてマスクすると、その中に
       挿入される改行で行そのものが分断され、R|行の展開自体が失敗する。
       （R|行がタグの属性値の中に来ることは実務上まず無いため、この経路には
       maskRegionsAndTagsを適用しない） */
    s = replaceUnmasked(s, maskRegions(s), RE_COMPACT_REF, function (all, rest, offset) {
      var f = rest.split("|");
      /* R|id|type|書誌テキスト|URL。書誌テキストに | が入っても最後の欄をURLとして扱う
         ……のが原則だが、URL自身（クエリ文字列等）に生の | が入っていると最後の欄が
         URLの断片だけになり展開に失敗する。末尾から https?:// で始まる欄を探し、
         そこから最後までを | でつなぎ戻してURLとする（＝URLの内部に | があっても
         正しく1本のURLとして復元できる） */
      if (f.length < 4) return all;
      var urlStart = -1;
      for (var fi = f.length - 1; fi >= 2; fi--) {
        if (/^https?:\/\//i.test(f[fi].trim())) { urlStart = fi; break; }
      }
      if (urlStart < 0) return all;
      var url = f.slice(urlStart).join("|").trim();
      var rid = (f[0] || "").trim();
      if (!/^[0-9A-Za-z][0-9A-Za-z-]*$/.test(rid)) return all;
      rid = canonId(rid);
      var type = (f[1] || "").trim();
      var text = f.slice(2, urlStart).join("|").trim();
      out.refs++;
      var idAttr = inAppendix(offset) ? "" : ' id="ref-' + rid + '"';
      /* R|行は素のテキスト（KIT §5.2）。題名の & < > " やURLのクエリをそのまま連結すると
         書誌が壊れ、外部ページ由来の on* 属性が混入しうるので必ずエスケープする */
      return "<li" + idAttr + (type ? ' data-source-type="' + escText(type) + '"' : "") +
        '><a href="' + escText(url) + '" target="_blank" rel="noopener">' + escText(text) + "</a></li>";
    });

    if (out.cites || out.refs) { out.html = s; out.changed = true; }
    return out;
  }

  /* 自動修復（v5.1+文書のみ）。AIに直してもらう必要がない構造的な不備を、
     機械的に安全な範囲だけ直す。文章の中身・数値・主張には一切触れない。
     renumberRefs より前に実行する（参考文献の増減が採番に影響するため） */
  function autoRepair(html) {
    var s = String(html || "");
    var out = { html: s, changed: false, merged: [], moved: [], moveSkipped: "", removedTags: [], strippedAttrs: 0, unwrapped: 0, structureMoved: [], dedup: [] };
    var doc = parseDoc(s);
    if (!doc || !doc.body) return out;

    /* R6. 重複した骨格・章の統合（R0より前に実行する。R0は .body-columns が1つである
       前提で動くため）。実走で、無料版ChatGPTが後のPARTで本文の枠 <div class="body-columns">
       やスケルトンごと出し直し、結合後に枠が2重になる事例が繰り返し起きた。貼り直しでは
       直らない（AI自身の出力が重複している）ので、内容を失わない範囲だけ機械で直す。
         (a) .body-columns が複数 → 2つ目以降の中身を1つ目の末尾へ移し、空の枠を削除する
         (b) 同一idのsection・8ランドマークが複数で、テキストが完全一致 → 後の方を削除する
       内容が異なる重複は消さない（改稿版の可能性がある）。それは check 18 が赤で知らせ、
       viewer側がAI向けの出し直し文を作る */
    var normText = function (el) { return String((el.textContent || "")).replace(/\s+/g, " ").trim(); };
    var bcAll = Array.prototype.slice.call(doc.querySelectorAll(".body-columns"));
    if (bcAll.length > 1) {
      var keepBc = bcAll[0];
      bcAll.slice(1).forEach(function (extra) {
        while (extra.firstChild) keepBc.appendChild(extra.firstChild);
        if (extra.parentNode) extra.parentNode.removeChild(extra);
      });
      out.dedup.push({ kind: "body-columns", count: bcAll.length - 1 });
    }
    var DEDUP_SEL = [".cover", "#sec-exec", "#sec-method", "#references", "#apx-a", "#apx-b", ".disclaimer"];
    DEDUP_SEL.forEach(function (sel) {
      var els = Array.prototype.slice.call(doc.querySelectorAll(sel));
      if (els.length < 2) return;
      var base = normText(els[0]);
      els.slice(1).forEach(function (el) {
        if (normText(el) !== base) return; /* 内容が違うなら消さない（check 18へ委ねる） */
        if (el.parentNode) { el.parentNode.removeChild(el); out.dedup.push({ kind: sel, count: 1 }); }
      });
    });
    var secById = {};
    Array.prototype.forEach.call(doc.querySelectorAll('section[id^="sec-"]'), function (sec) {
      var id = sec.getAttribute("id") || "";
      if (!secById[id]) { secById[id] = sec; return; }
      if (normText(sec) !== normText(secById[id])) return; /* 内容が違うなら消さない */
      if (sec.parentNode) { sec.parentNode.removeChild(sec); out.dedup.push({ kind: id, count: 1 }); }
    });

    /* R0. 調査手法・参考文献・付録・免責が <div class="body-columns"> の内側にある場合、
       外（直後）へ出す。2段組・章の自動採番・改ページ・本文分量の判定が壊れるのを防ぐ
       （KIT §19.2）。移した結果 .body-columns に本文章が1つも残らない場合は分類を
       誤っている可能性が高いので何もしない */
    var bc = doc.querySelector(".body-columns");
    if (bc) {
      var cands = Array.prototype.slice.call(bc.querySelectorAll(TAIL_SEL));
      Array.prototype.forEach.call(bc.querySelectorAll("section"), function (sec) {
        var h2 = sec.querySelector("h2");
        if (h2 && (h2.textContent || "").indexOf("調査手法") !== -1 && cands.indexOf(sec) === -1) cands.push(sec);
      });
      /* 入れ子（付録Aの中の .references 等）は一番外側だけを動かす */
      cands = cands.filter(function (el) {
        var p = el.parentNode;
        while (p && p !== bc) { if (cands.indexOf(p) !== -1) return false; p = p.parentNode; }
        return true;
      });
      cands.sort(function (a, b) { return (a.compareDocumentPosition(b) & 2) ? 1 : -1; });
      var restCount = 0;
      Array.prototype.forEach.call(bc.children, function (el) { if (cands.indexOf(el) === -1) restCount++; });
      if (cands.length && restCount > 0) {
        var anchor = null, sib = bc.nextSibling;
        while (sib) {
          if (sib.nodeType === 1 && sib.matches && sib.matches(TAIL_SEL)) { anchor = sib; break; }
          sib = sib.nextSibling;
        }
        if (!anchor) anchor = bc.nextSibling;
        cands.forEach(function (el) {
          out.structureMoved.push(el.id || (el.className ? String(el.className).split(" ")[0] : el.tagName.toLowerCase()));
          bc.parentNode.insertBefore(doc.createTextNode("\n"), anchor);
          bc.parentNode.insertBefore(el, anchor);
        });
      }
    }

    /* R1. 同一URLの参考文献を1件に統合し、引用を残す側へ付け替える */
    var lis = Array.prototype.filter.call(doc.querySelectorAll('li[id^="ref-"]'), notInAppendix);
    var firstOf = {};
    lis.forEach(function (li) {
      var a = li.querySelector("a[href]");
      if (!a) return;
      var key = normalizeRefUrl(a.getAttribute("href"));
      if (!key) return;
      var id = li.id.slice("ref-".length);
      if (!firstOf[key]) { firstOf[key] = id; return; }
      out.merged.push({ from: id, to: firstOf[key] });
    });
    /* li.id は任意の貼り付けHTMLから来ることがあり、"（二重引用符）等を含むと
       文字列連結で組んだセレクタが壊れ querySelectorAll が SyntaxError を投げて
       修復処理全体が無言で落ちる。CSS.escape（無ければ簡易フォールバック）で
       安全なセレクタにしてから使う */
    var cssEscapeAttr = function (s) {
      s = String(s);
      if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
      return s.replace(/["\\]/g, "\\$&");
    };
    out.merged.forEach(function (m) {
      Array.prototype.forEach.call(doc.querySelectorAll('a[href="#ref-' + cssEscapeAttr(m.from) + '"]'), function (a) {
        a.setAttribute("href", "#ref-" + m.to);
        var t = (a.textContent || "").trim();
        if (/^\[[^\]]*\]$/.test(t) || t === m.from) a.textContent = "[" + m.to + "]";
      });
      var li = doc.getElementById("ref-" + m.from);
      if (li && li.parentNode) li.parentNode.removeChild(li);
    });
    /* 統合の結果、1つの<sup>内に同じ参考文献への引用が並んだ場合は1つに畳む。
       2026-09-03(7回目・初実走FB): 従来はMERGEが起きた場合だけ実行していたが、
       実走のPDFで"[1][1]"（隣接する別の<sup>グループが同じ資料IDを引く）が見つかった
       ため、MERGE有無にかかわらず常時実行し、隣接する<sup>同士の重複も畳む */
    /* 2026-09-03(バグ修正): 同じ資料への引用でも、担当するClaimが違えば重複ではない
       （1つの資料を多数のClaimが根拠にするのは正常）。href単独ではなくhref+data-claim
       の組で同一性を見る（キーはtrim・大文字小文字を区別。data-claim無しは常に個別扱い） */
    function citeDedupeKey(a) {
      var claim = a.getAttribute("data-claim");
      return a.getAttribute("href") + "|" + (claim ? claim.trim() : "");
    }
    Array.prototype.forEach.call(doc.querySelectorAll("sup"), function (sup) {
      var seen = {};
      Array.prototype.slice.call(sup.querySelectorAll('a[href^="#ref-"]')).forEach(function (a) {
        var k = citeDedupeKey(a);
        if (seen[k]) { if (a.parentNode) a.parentNode.removeChild(a); out.dedup.push(k); } else seen[k] = true;
      });
    });
    /* 隣接する<sup>同士（間に空白以外の文字が無いもの）も同じ資料ID・同じClaimへの
       引用が重複していれば畳む。空になった<sup>は取り除く。
       out.dedupへ記録しないと末尾の「changedフラグが1つも立っていなければ
       再シリアライズしない」ガードに引っかかり、このDOM変更が最終htmlに反映されない */
    Array.prototype.forEach.call(doc.querySelectorAll("sup"), function (sup) {
      var next = sup.nextSibling;
      while (next && next.nodeType === 3 && !/\S/.test(next.textContent || "")) next = next.nextSibling;
      if (!next || next.nodeType !== 1 || next.tagName !== "SUP") return;
      var seen = {};
      Array.prototype.slice.call(sup.querySelectorAll('a[href^="#ref-"]')).forEach(function (a) { seen[citeDedupeKey(a)] = true; });
      Array.prototype.slice.call(next.querySelectorAll('a[href^="#ref-"]')).forEach(function (a) {
        var k = citeDedupeKey(a);
        if (seen[k]) { if (a.parentNode) a.parentNode.removeChild(a); out.dedup.push(k); } else seen[k] = true;
      });
      if (!next.querySelector('a[href^="#ref-"]') && next.parentNode) next.parentNode.removeChild(next);
    });

    /* R2. 本文で1度も引用されていない参考文献を付録A（参照資料一覧）へ移す。
       「引用が存在するか」ではなく「引用先IDが参考文献に解決するか」を見る。
       採番方式の食い違いやhrefの誤記が1件でもあると「未引用」の判定自体が信用できず、
       誤って参考文献を全滅させかねないので、そのときは何もしない。
       解決しない引用先は検査2が元のIDで赤く報告し、直った次の回にここが動く */
    var anchors = Array.prototype.filter.call(doc.querySelectorAll('a[href^="#ref-"]'), notInAppendix);
    var apxOl = doc.querySelector(".appendix.references ol") || doc.querySelector("#apx-a ol");
    var refLis = Array.prototype.filter.call(doc.querySelectorAll('li[id^="ref-"]'), notInAppendix);
    var citeTargets = [], cited = {};
    anchors.forEach(function (a) {
      var id = (a.getAttribute("href") || "").slice("#ref-".length);
      if (!id || cited[id]) return;
      cited[id] = true; citeTargets.push(id);
    });
    var definedIds = {};
    refLis.forEach(function (li) { definedIds[li.id.slice("ref-".length)] = true; });
    var unresolved = citeTargets.filter(function (id) { return !definedIds[id]; });
    var uncitedLis = refLis.filter(function (li) { return !cited[li.id.slice("ref-".length)]; });
    if (!apxOl) {
      out.moveSkipped = "付録Aが無い";
    } else if (!citeTargets.length) {
      out.moveSkipped = "本文に引用が1件も無い";
    } else if (unresolved.length) {
      out.moveSkipped = "参考文献に解決しない引用先がある: " +
        unresolved.slice(0, 5).map(function (id) { return "ref-" + id; }).join(", ");
    } else if (uncitedLis.length && uncitedLis.length === refLis.length) {
      out.moveSkipped = "全件が未引用（判定を誤っている可能性）";
    } else {
      uncitedLis.forEach(function (li) {
        out.moved.push(li.id.slice("ref-".length));
        li.removeAttribute("id");
        apxOl.appendChild(doc.createTextNode("\n"));
        apxOl.appendChild(li);
      });
    }
    /* 2026-09-03(7回目・初実走FB): 閲覧のみ0件の調査では付録Aが空の<ol>のまま残り、
       見出しだけの白紙ページになる（実走で確認）。KIT §19.2項目8・9と同じ
       「該当なし」1行を機械側でも補う（AIが省略しても壊れないように） */
    /* moveSkippedがある場合は判定自体を信用していない状態なので、
       apxOlが空でも「該当なし」を書かない（検出失敗を「0件確定」と混同しない） */
    if (apxOl && !out.moveSkipped && !apxOl.querySelector("li")) {
      var noneLi = doc.createElement("li");
      noneLi.className = "none";
      noneLi.textContent = "該当なし";
      apxOl.appendChild(doc.createTextNode("\n"));
      apxOl.appendChild(noneLi);
      out.dedup.push("apx-a-none");
    }

    /* R3. 許可外のタグを削除し、style／onclick属性を外す（要素自体と文章は残す） */
    Array.prototype.slice.call(doc.body.querySelectorAll(
      'img, iframe, object, embed, link, style, script:not([type="application/ld+json"])'
    )).forEach(function (el) {
      out.removedTags.push(el.tagName.toLowerCase());
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    /* head側の許可外部品も同じ基準で削除する。<link>はビューア表示時点で外部
       リクエストを発生させ、<script>（非JSON-LD）はダウンロードHTMLで実行される
       ため、「どこにも送信されません」の前提が崩れる。headのstyleはensureStyleが
       先に注入した組版CSSなので対象外にする */
    if (doc.head) {
      Array.prototype.slice.call(doc.head.querySelectorAll(HEAD_FORBIDDEN_SEL)).forEach(function (el) {
        out.removedTags.push(el.tagName === "META" ? "meta[http-equiv]" : el.tagName.toLowerCase());
        if (el.parentNode) el.parentNode.removeChild(el);
      });
    }
    /* onclick だけでなく onload・onmouseover 等のイベント属性をすべて外す
       （「HTMLをダウンロード」で配布したファイルでは実際に発火するため）。head側の
       残った要素（meta/title/style/ld+json）にも同じ処理をかける */
    Array.prototype.slice.call(doc.body.querySelectorAll("*")).forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (at) {
        if (at.name === "style" || /^on/i.test(at.name)) { el.removeAttribute(at.name); out.strippedAttrs++; }
      });
    });
    if (doc.head) {
      Array.prototype.slice.call(doc.head.querySelectorAll("*")).forEach(function (el) {
        Array.prototype.slice.call(el.attributes).forEach(function (at) {
          if (at.name === "style" || /^on/i.test(at.name)) { el.removeAttribute(at.name); out.strippedAttrs++; }
        });
      });
    }

    /* R5. 本文見出しに手打ちされた章番号を外す。組版CSSは .body-columns の h2/h3 に
       counter で番号を振る（rr-report-css.js の h2::before/h3::before）ため、AIが
       見出しテキストにも「1.」と書くと「1. 1. 章題」と二重に出る（実地で確認）。
       .body-columns 内の見出しの先頭にある番号だけを対象にし、参考文献・付録・
       調査手法など採番対象外の見出しには触れない */
    var bcH = doc.querySelector(".body-columns");
    if (bcH) {
      Array.prototype.slice.call(bcH.querySelectorAll("h2, h3")).forEach(function (h) {
        var first = h.firstChild;
        /* 先頭のテキストノードだけを見る（<strong>等で囲まれた見出しの中身は触らない） */
        if (!first || first.nodeType !== 3) return;
        var t = first.textContent;
        /* 「1.」「1．」「2.3」「第3章」＋区切り。番号だけの見出し（本文が空）は変換しない */
        var m = t.match(/^[\s\u3000]*(?:第\s*[0-9０-９]{1,3}\s*章|[0-9０-９]{1,2}(?:[.．][0-9０-９]{1,2}){0,3})(?:[.．、,:：)）\]】][\s　 ]+(?=\S)|[.．、,:：)）\]】](?=[^\s　\d０-９])|[\s　 ]+(?=\S))/);
        if (!m) return;
        first.textContent = t.slice(m[0].length);
        out.headingNumbers = (out.headingNumbers || 0) + 1;
      });
    }

    /* R4. 本文中の外部リンクと mailto:/tel:/javascript: を解除する（表示テキストは残す） */
    Array.prototype.filter.call(doc.body.querySelectorAll("a[href]"), function (a) {
      var h = a.getAttribute("href") || "";
      if (/^(mailto:|tel:|javascript:)/i.test(h)) return true;
      if (/^https?:/i.test(h)) return !(a.closest && a.closest(".references, .appendix, .disclaimer"));
      return false;
    }).forEach(function (a) {
      var parent = a.parentNode;
      if (!parent) return;
      while (a.firstChild) parent.insertBefore(a.firstChild, a);
      parent.removeChild(a);
      out.unwrapped++;
    });

    if (out.merged.length || out.moved.length || out.removedTags.length || out.strippedAttrs || out.unwrapped || out.structureMoved.length || out.headingNumbers || out.dedup.length) {
      var dt = doc.doctype ? "<!DOCTYPE " + doc.doctype.name + ">\n" : "";
      out.html = dt + doc.documentElement.outerHTML;
      out.changed = true;
    }
    return out;
  }

  function renumberRefs(html) {
    var s = String(html || "");
    var doc = parseDoc(s);
    var res = { html: s, changed: false, refCount: 0, unreferenced: [], map: {} };
    if (!doc || !doc.body) return res;
    /* 検査2（引用番号↔参考文献の突合）と同じ述語: .appendix外の a[href^="#ref-"] すべて
       （<sup>で包まれていない引用、例: 表の<td>内の裸のリンクも対象にする） */
    var anchors = Array.prototype.filter.call(doc.querySelectorAll('a[href^="#ref-"]'), notInAppendix);
    if (!anchors.length) return res;
    var map = {}, order = [];
    anchors.forEach(function (a) {
      var old = (a.getAttribute("href") || "").slice("#ref-".length);
      if (!old) return;
      if (!map[old]) { order.push(old); map[old] = order.length; }
    });
    var lis = Array.prototype.filter.call(doc.querySelectorAll('li[id^="ref-"]'), notInAppendix);
    var unreferenced = lis.filter(function (li) { return !map[li.id.slice("ref-".length)]; });
    var next = order.length;
    unreferenced.forEach(function (li) { map[li.id.slice("ref-".length)] = ++next; });
    res.refCount = order.length;
    res.unreferenced = unreferenced.map(function (li) { return li.id.slice("ref-".length); });
    res.map = map;
    // 変更が必要か（既に 1..N 出現順で ol も同順なら何もしない）
    var identity = Object.keys(map).every(function (k) { return String(map[k]) === k; });
    var ordered = true;
    var ols = [];
    lis.forEach(function (li) { var ol = li.parentNode; if (ol && ols.indexOf(ol) === -1) ols.push(ol); });
    ols.forEach(function (ol) {
      var items = Array.prototype.filter.call(ol.children, function (c) { return c.tagName === "LI" && /^ref-/.test(c.id); });
      for (var i = 1; i < items.length; i++) {
        if (map[items[i - 1].id.slice(4)] > map[items[i].id.slice(4)]) ordered = false;
      }
    });
    if (identity && ordered) return res;
    // 書き換え
    anchors.forEach(function (a) {
      var old = (a.getAttribute("href") || "").slice("#ref-".length);
      var nn = map[old];
      if (!nn) return;
      a.setAttribute("href", "#ref-" + nn);
      var t = (a.textContent || "").trim();
      if (/^\[[^\]]*\]$/.test(t) || t === old) a.textContent = "[" + nn + "]";
    });
    lis.forEach(function (li) { var nn = map[li.id.slice("ref-".length)]; if (nn) li.id = "ref-" + nn; });
    ols.forEach(function (ol) {
      var children = Array.prototype.slice.call(ol.childNodes);
      var refItems = children.filter(function (c) { return c.nodeType === 1 && c.tagName === "LI" && /^ref-\d+$/.test(c.id); });
      var others = children.filter(function (c) { return refItems.indexOf(c) === -1 && !(c.nodeType === 3 && !c.textContent.trim()); });
      refItems.sort(function (a, b) { return parseInt(a.id.slice(4), 10) - parseInt(b.id.slice(4), 10); });
      while (ol.firstChild) ol.removeChild(ol.firstChild);
      refItems.concat(others).forEach(function (c) { ol.appendChild(doc.createTextNode("\n")); ol.appendChild(c); });
      ol.appendChild(doc.createTextNode("\n"));
    });
    var dt = doc.doctype ? "<!DOCTYPE " + doc.doctype.name + ">\n" : "";
    res.html = dt + doc.documentElement.outerHTML;
    res.changed = true;
    return res;
  }

  /* 集計値をDOMから計算する（LLMは数字を書かない） */
  function computeReportStats(doc) {
    var st = { refCount: 0, primaryCount: 0, primaryRatio: "－", appendixCount: 0, consultedCount: 0, publisherCount: 0,
      categoryCount: 0, categoryText: "9分類中0", claimCount: 0, citationCount: 0, unconfirmedCount: 0, targetCount: 0,
      period: "", confirmedCount: "" };
    if (!doc || !doc.body) return st;
    var refs = Array.prototype.filter.call(doc.querySelectorAll('li[id^="ref-"]'), notInAppendix);
    st.refCount = refs.length;
    refs.forEach(function (li) { if (PRIMARY_TYPES.indexOf((li.getAttribute("data-source-type") || "").trim().toLowerCase()) !== -1) st.primaryCount++; });
    st.primaryRatio = refs.length ? Math.round(st.primaryCount / refs.length * 100) + "%" : "－";
    var apxA = doc.querySelector("#apx-a, #apx-sources") || doc.querySelector("section.appendix.references") || appendixByHeading(doc, "付録A");
    var apxItems = apxA ? Array.prototype.slice.call(apxA.querySelectorAll("li")) : [];
    st.appendixCount = apxItems.length;
    var urlSeen = {}, pubSeen = {}, catSeen = {};
    var consulted = 0;
    function firstUrl(li) { var a = li.querySelector('a[href^="http"]'); return a ? a.getAttribute("href") : ""; }
    function noteUrl(u) {
      if (!u) return;
      var d = etld1(domainOf(u));
      if (d) pubSeen[d] = true;
    }
    refs.forEach(function (li) {
      consulted++;
      var u = firstUrl(li);
      if (u) { urlSeen[normalizeRefUrl(u)] = true; noteUrl(u); }
      var t = li.getAttribute("data-source-type"); if (t && t.trim()) catSeen[typeCode(t)] = true;
    });
    apxItems.forEach(function (li) {
      var u = firstUrl(li);
      var key = u ? normalizeRefUrl(u) : "";
      if (!key || !urlSeen[key]) { consulted++; if (key) urlSeen[key] = true; }
      noteUrl(u);
      var t = li.getAttribute("data-source-type"); if (t && t.trim()) catSeen[typeCode(t)] = true;
    });
    st.consultedCount = consulted;
    st.publisherCount = Object.keys(pubSeen).length;
    st.categoryCount = Object.keys(catSeen).length;
    st.categoryText = "9分類中" + st.categoryCount;
    var cited = citedClaimSet(doc);
    var claimIds = {};
    Object.keys(cited).forEach(function (id) { claimIds[id] = true; });
    var unc = parseUncited(doc.documentElement ? doc.documentElement.outerHTML : "");
    unc.entries.forEach(function (e) { if (/^C-/.test(e.id)) claimIds[e.id] = true; });
    st.claimCount = Object.keys(claimIds).length;
    st.citationCount = Array.prototype.filter.call(doc.querySelectorAll('sup a[href^="#ref-"]'), notInAppendix).length;
    var apxB = doc.querySelector("#apx-b, #apx-unconfirmed") || appendixByHeading(doc, "付録B");
    st.unconfirmedCount = apxB ? Array.prototype.filter.call(apxB.querySelectorAll("li"), function (li) { return !(li.classList && li.classList.contains("none")); }).length : 0;
    var ents = {};
    Array.prototype.forEach.call(doc.querySelectorAll("[data-entity]"), function (el) {
      var raw = (el.textContent || "").trim();
      if (!raw) return;
      /* 全角/半角・内部の空白の違いで同一対象が別カウントにならないよう正規化してから重複除去
         （例: Ａ社／A社／A 社 はすべて同一） */
      var norm = raw.normalize ? raw.normalize("NFKC").replace(/\s+/g, "") : raw.replace(/\s+/g, "");
      if (norm) ents[norm] = true;
    });
    st.targetCount = Object.keys(ents).length;
    /* {{RR:...}} トークンの値がそのまま自己参照でmetaや表紙に残っていた場合は使わない
       （PERIODトークンの解決に自分自身を使ってしまう無限参照を避ける） */
    var cov = metaContent(doc, "DC.coverage");
    if (/\{\{\s*RR:/.test(cov)) cov = "";
    if (!cov) cov = coverValue(coverLines(doc), "情報対象期間");
    if (/\{\{\s*RR:/.test(cov)) cov = "";
    st.period = cov ? cov.replace(/^(\d{4}-\d{2})\s*[\/／~～]\s*(\d{4}-\d{2})$/, "$1〜$2") : "";
    st.confirmedCount = digitsOf(metaContent(doc, "rr:confirmed-count"));
    return st;
  }

  function escText(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function statTile(n, label) {
    return '<div class="stat"><div class="n">' + escText(n) + '</div><div class="l">' + escText(label) + "</div></div>";
  }
  function coverageCardHtml(st) {
    return '<div class="stat-row">' +
      statTile(st.consultedCount, "参照資料（本文引用 " + st.refCount + "・閲覧のみ " + st.appendixCount + "）") +
      statTile(st.publisherCount, "独立発行元（推定）") +
      statTile(st.primaryRatio, "一次資料比率（本文引用資料）") +
      statTile(st.categoryText, "情報源カテゴリ") +
      "</div>" +
      '<div class="stat-row">' +
      statTile(st.claimCount, "確認事実（本文で引用・集約）") +
      statTile(st.citationCount, "引用リンク") +
      statTile(st.unconfirmedCount, "未確認事項（付録B）") +
      statTile(st.period || "－", "情報対象期間") +
      "</div>";
  }
  function coverStatsHtml(st) {
    /* 2026-09-03(7回目・初実走FB): 閲覧のみ0件だとconsultedCount===refCountになり、
       「参考文献」「参照資料」に同じ数字が並んで冗長だった（実走で確認）。
       閲覧のみが無いときはこのタイルを省く */
    var consultedTile = st.appendixCount > 0 ? statTile(st.consultedCount, "参照資料") : "";
    return '<div class="stat-row">' +
      statTile(st.refCount, "参考文献") +
      consultedTile +
      statTile(st.publisherCount, "独立発行元（推定）") +
      statTile(st.primaryRatio, "一次資料比率") +
      statTile(st.claimCount, "確認事実") +
      statTile(st.unconfirmedCount, "未確認事項") +
      "</div>";
  }

  /* {{RR:NAME}} を置換する。未知のトークンは残して unknown に列挙する */
  function fillTokens(html) {
    var s = String(html || "");
    var out = { html: s, filled: {}, unknown: [], seen: 0, stats: null, misplaced: [] };
    var re = /\{\{\s*RR:\s*([A-Za-z_]+)\s*\}\}/g;
    if (!re.test(s)) return out;
    var doc = parseDoc(s);
    var st = computeReportStats(doc);
    out.stats = st;
    var values = {
      SOURCE_COUNT: String(st.refCount),
      PRIMARY_COUNT: String(st.primaryCount),
      PRIMARY_RATIO: st.primaryRatio,
      CONSULTED_COUNT: String(st.consultedCount),
      APPENDIX_SOURCE_COUNT: String(st.appendixCount),
      PUBLISHER_COUNT: String(st.publisherCount),
      SOURCE_CATEGORY_COUNT: st.categoryText,
      CLAIM_COUNT: String(st.claimCount),
      CITATION_COUNT: String(st.citationCount),
      UNCONFIRMED_COUNT: String(st.unconfirmedCount),
      TARGET_COUNT: String(st.targetCount),
      PERIOD: st.period || "－",
      CONFIRMED_COUNT: st.confirmedCount || "－",
      COVERAGE_CARD: coverageCardHtml(st),
      COVER_STATS: coverStatsHtml(st)
    };
    re.lastIndex = 0;
    out.html = s.replace(re, function (all, rawName, offset) {
      out.seen++;
      var name = rawName.toUpperCase();
      var canon = TOKEN_ALIASES[name] || name;
      if (values[canon] === undefined) { if (out.unknown.indexOf(rawName) === -1) out.unknown.push(rawName); return all; }
      /* COVER_STATS/COVERAGE_CARDはタグを含むHTML断片。属性値の中（直前の<が>より
         後ろにある位置）へ差し込むとタグが壊れるので、そこでは置換せず未置換のまま
         残す（check 1 の未置換チェックが検出する） */
      var v = values[canon];
      if (/[<]/.test(v)) {
        var lt = s.lastIndexOf("<", offset), gt = s.lastIndexOf(">", offset);
        if (lt > gt) { if (out.misplaced.indexOf(canon) === -1) out.misplaced.push(canon); return all; }
      }
      out.filled[canon] = v;
      return v;
    });
    return out;
  }

  /* v5.1文書かどうか（PART結合／トークン置換／kit-version≥5.1 のいずれか） */
  function isV51(info) {
    if (!info) return false;
    if (info.parts) return true;
    if (info.tokens && info.tokens.seen > 0) return true;
    return !!info.v51;
  }

  function addV51InfoRows(results, info) {
    if (!info) return;
    if (info.partSet && info.partSet.dropped && info.partSet.dropped.length) {
      var reason = info.partSet.mode === "newReport" ? "別レポートのPART" : "前の分割のPART";
      addResult(results, true, reason + " " + info.partSet.dropped.join(", ") + " を破棄して結合しました", "",
        { kind: "log", title: info.partSet.mode === "newReport"
            ? "前のレポートのPARTは使っていません" : "分割のしかたが変わったので、古い分割のPARTは使っていません" });
    }
    if (info.parts && info.parts.n) {
      addResult(results, true, "レポートを PART 1〜" + info.parts.n + "（" + info.parts.n + "分割）から結合しました", "",
        { kind: "log", title: "分かれて届いた " + info.parts.n + " 個のレポートを1つにつなぎました" });
      if (info.parts.softEnd && info.parts.softEnd.length) {
        addResult(results, true, "RR-END の無いPARTを結合しました",
          "PART " + info.parts.softEnd.join(", ") + " は <!-- RR-END --> が無いまま次のPART（または </html>）が続いていたため、そのまま結合しました。",
          { kind: "log", title: "区切りの目印が無い部分も、内容がつながっていたため結合しました" });
      }
    }
    if (info.cssInjected !== undefined) {
      if (info.cssInjected) addResult(results, true, "レポート書式（CSS）を付与しました", "レポートには書式が含まれていないため、ビューアが共通の書式CSSを <head> に挿入しました。プレビュー・保存にはこの内容を使います。",
        { kind: "log", title: "レポートに見た目の書式を付けました" });
      else if (info.cssFailed) addResult(results, false, "書式CSSを挿入できませんでした（</head> が見つかりません）", "HTMLの先頭部分（<!DOCTYPE html>〜</head>）が欠けている可能性があります。PART 1 を貼り直してください。",
        { local: true, title: "レポートの先頭部分が欠けていて、書式を付けられませんでした", next: "PART 1 を貼り直す" });
    }
    if (info.renumber && info.renumber.changed) {
      addResult(results, true, "参考文献番号を本文の出現順（1〜" + info.renumber.refCount + "）に付け直しました", "引用の番号と参考文献リストの並びを、本文で最初に登場した順に振り直しました（data-claim は変更していません）。",
        { kind: "log", title: "参考文献の番号を本文に登場する順に整えました" });
    }
    var rep = info.repair;
    if (rep && rep.changed) {
      if (rep.dedup && rep.dedup.length) {
        var bcDup = rep.dedup.filter(function (d) { return d.kind === "body-columns"; })[0];
        var otherDup = rep.dedup.filter(function (d) { return d.kind !== "body-columns"; });
        if (bcDup) {
          addResult(results, true, "本文の枠が2重になっていたため1つに統合しました",
            "<div class=\"body-columns\"> が" + (bcDup.count + 1) + "個ありました。内容を失わずに1つ目へまとめました（PARTの一部でAIが本文の枠を出し直した可能性があります）。",
            { kind: "log", title: "本文の枠の重複をまとめました" });
        }
        if (otherDup.length) {
          addResult(results, true, "同一内容の重複 " + otherDup.length + " 件を1つにしました",
            "同じ内容の章・部分が複数回出力されていたため、後から出た方を取り除きました: " +
            otherDup.map(function (d) { return d.kind; }).slice(0, 8).join("、"),
            { kind: "log", title: "同じ内容の重複を取り除きました（" + otherDup.length + "件）" });
        }
      }
      if (rep.structureMoved && rep.structureMoved.length) {
        addResult(results, true, "参考文献・付録・免責・調査手法の章を本文2段組の外へ移しました",
          "<div class=\"body-columns\"> の内側にあった " + rep.structureMoved.slice(0, 6).join("、") +
          " を、規定どおり本文章の後ろ（2段組の外）へ移しました。章番号の自動採番・改ページ・本文分量の判定が正しく働きます。",
          { kind: "log", title: "参考文献・付録の位置を整えました" });
      }
      if (rep.merged.length) {
        addResult(results, true, "同一URLの参考文献 " + rep.merged.length + " 件を1件に統合しました",
          "同じURLを指す参考文献が複数あったため、先に登場する1件へ引用をまとめました。統合した項目: " +
          rep.merged.slice(0, 8).map(function (m) { return "ref-" + m.from + "→ref-" + m.to; }).join(", "),
          { kind: "log", title: "同じ資料が重複していた参考文献 " + rep.merged.length + " 件を1つにまとめました" });
      }
      if (rep.headingNumbers) {
        addResult(results, true, "見出しの手打ち章番号 " + rep.headingNumbers + " 件を外しました",
          "組版CSSが章番号を自動で振るため、見出しに書かれていた番号を外しました（「1. 1. 章題」のような二重表示を防ぎます）。",
          { kind: "log", title: "見出しの番号の重複を直しました（" + rep.headingNumbers + "件）" });
      }
      var cleaned = rep.removedTags.length + rep.strippedAttrs + rep.unwrapped;
      if (cleaned) {
        var parts = [];
        if (rep.removedTags.length) parts.push("削除したタグ: " + rep.removedTags.slice(0, 8).join(", "));
        if (rep.strippedAttrs) parts.push("除去した style／on*（onclick等）属性: " + rep.strippedAttrs + " 件");
        if (rep.unwrapped) parts.push("解除した本文中のリンク（外部URL・mailto:・tel:・javascript:）: " + rep.unwrapped + " 件。表示テキストは残しています");
        addResult(results, true, "許可外のタグ・属性・リンク " + cleaned + " 件を取り除きました", parts.join("／"),
          { kind: "log", title: "レポートに使えない部品・リンク " + cleaned + " 件を取り除きました" });
      }
    }
    if (info.tokens && info.tokens.filled) {
      var keys = Object.keys(info.tokens.filled).filter(function (k) { return k !== "COVERAGE_CARD" && k !== "COVER_STATS"; });
      var n = Object.keys(info.tokens.filled).length;
      if (n) {
        addResult(results, true, "集計トークン " + n + " 個をレポート内の要素数から置換しました",
          keys.map(function (k) { return k + "=" + info.tokens.filled[k]; }).join(", "),
          { kind: "log", title: "参考文献の数などの集計値をレポートに書き込みました" });
      }
    }
  }

  function runV51Checks(html, results, info) {
    if (!isV51(info)) return;
    var doc = parseDoc(html);
    if (!doc || !doc.body) return;

    // 14-0. 自動修復で付録Aへ移した未引用資料（引用漏れの可能性は残るので参考として残す）
    if (info.repair && info.repair.moved && info.repair.moved.length) {
      var mv = info.repair.moved;
      addResult(results, false, "本文で引用していない参考文献 " + mv.length + " 件を付録Aへ移しました",
        "本文から一度も引用されていなかったため、参考文献リストから付録A（参照資料一覧）へ移動しました。該当: " +
        mv.slice(0, 8).map(function (o) { return "ref-" + o; }).join(", ") +
        "。本文で使いたい場合は、AIに該当資料を本文へ引用するよう依頼してください",
        { kind: "warn", title: "本文で引用していない資料 " + mv.length + " 件を付録へ移しました（このままでも完成します）" });
    }

    // 14. 本文で引用されていない参考文献（付録Aへ移すべきもの）
    if (info.renumber && info.renumber.unreferenced && info.renumber.unreferenced.length) {
      var d14 = "参考文献リストには本文で引用した資料だけを載せ、引用していない資料は付録A（参照資料一覧）へ移してください。該当: " +
        info.renumber.unreferenced.slice(0, 8).map(function (o) { return "ref-" + o; }).join(", ");
      if (info.repair && info.repair.moveSkipped) d14 += "（自動で付録Aへ移せなかった理由: " + info.repair.moveSkipped + "）";
      addResult(results, false, "本文で引用されていない参考文献 " + info.renumber.unreferenced.length + " 件", d14,
        { kind: "warn", title: "本文で引用していない資料が参考文献リストに残っています（" + info.renumber.unreferenced.length + "件）" });
    }

    // 新規: 許可外タグ・属性（v5.1+文書は全体で禁止。style/link/img/iframe/object/embed/
    //       script[JSON-LD以外]、および style属性・onclick属性）
    var FORBIDDEN_SEL = 'style, link, img, iframe, object, embed, script:not([type="application/ld+json"]), [style], [onclick]';
    /* <head> に挿入される書式用<style>は対象外。本文（<body>）を走査し、
       head側は HEAD_FORBIDDEN_SEL（R3と共有）で別途走査する。片方だけ禁じると
       もう一方が直せない赤を残すため、同じ定数を使う */
    var forb = Array.prototype.slice.call(doc.body.querySelectorAll(FORBIDDEN_SEL));
    if (doc.head) forb = forb.concat(Array.prototype.slice.call(doc.head.querySelectorAll(HEAD_FORBIDDEN_SEL)));
    /* onclick 以外のイベント属性はセレクタで列挙できないので走査して足す（head含む） */
    Array.prototype.forEach.call(doc.querySelectorAll("*"), function (el) {
      if (forb.indexOf(el) !== -1) return;
      for (var ai = 0; ai < el.attributes.length; ai++) {
        if (/^on/i.test(el.attributes[ai].name)) { forb.push(el); return; }
      }
    });
    addResult(results, forb.length === 0, "許可外のタグ・属性が使われていない（style/link/img/iframe/object/embed/script/onclick禁止）",
      forb.length ? "検出: " + forb.slice(0, 8).map(function (el) {
        var t = el.tagName === "META" ? "meta[http-equiv]" : el.tagName.toLowerCase();
        if (el.hasAttribute("style") && ["style", "link", "img", "iframe", "object", "embed", "script"].indexOf(t) === -1) t += "[style]";
        for (var ai = 0; ai < el.attributes.length; ai++) {
          if (/^on/i.test(el.attributes[ai].name)) t += "[" + el.attributes[ai].name + "]";
        }
        return t;
      }).join(", ") : "",
      { title: forb.length ? "レポートに使ってはいけない部品（画像・外部スタイル等）が入っています"
                           : "使ってはいけない部品は入っていません" });

    // 15. 本文の外部リンク（外部hrefは参考文献・付録・免責事項のみ）
    var ext = Array.prototype.filter.call(doc.querySelectorAll('a[href^="http"]'), function (a) {
      return !(a.closest && a.closest(".references, .appendix, .disclaimer"));
    });
    addResult(results, ext.length === 0, "本文に外部リンクが無い（外部URLは参考文献・付録・免責事項のみ）",
      ext.length ? "本文中の外部リンク " + ext.length + " 件: " + ext.slice(0, 5).map(function (a) { return a.getAttribute("href"); }).join(", ") + "。本文は引用番号（sup）で参照し、URLは参考文献に置いてください" : "",
      { title: ext.length ? "本文の中に直接リンクがあります（本文は引用番号で示す決まりです）"
                          : "本文に直接リンクはありません" });

    // 新規: 許可外リンク（mailto:/tel:/javascript:）はどこにも書けない（.disclaimer含む）
    var badScheme = Array.prototype.filter.call(doc.querySelectorAll("a[href]"), function (a) {
      return /^(mailto:|tel:|javascript:)/i.test((a.getAttribute("href") || "").trim());
    });
    addResult(results, badScheme.length === 0, "許可外リンク（mailto:/tel:/javascript:）が使われていない",
      badScheme.length ? "検出: " + badScheme.slice(0, 5).map(function (a) { return a.getAttribute("href"); }).join(", ") : "",
      { title: badScheme.length ? "使ってはいけない種類のリンク（メール・電話など）が入っています"
                                : "リンクの種類に問題はありません" });

    var ccContent = metaContent(doc, "rr:confirmed-count");
    var total = parseInt(digitsOf(ccContent), 10);
    if (!ccContent || !total || isNaN(total)) {
      addResult(results, false, "本文分量・確認済みID整合の判定ができません（このKITの形式のはずですが…）",
        "meta name=\"rr:confirmed-count\" が無いか読み取れません。本文分量とID整合の判定にはこの値が必要です。",
        { title: "調査で確認した件数を読み取れず、本文の分量などを判定できません" });
    } else {
      // 16. 本文分量: sup除くテキストが床（85%目標=0.85×120×確認済み件数 と 参考文献数×80字 の大きい方）以上
      var bodyCols = doc.querySelector(".body-columns");
      if (!bodyCols) {
        addResult(results, false, "本文の分量が確認できません（このKITの形式のはずですが…）", ".body-columns 要素が見つかりません。",
          { title: "本文部分を読み取れませんでした" });
      } else {
        var clone = bodyCols.cloneNode(true);
        Array.prototype.forEach.call(clone.querySelectorAll("sup"), function (el) { el.parentNode.removeChild(el); });
        var len = (clone.textContent || "").replace(/\s+/g, "").length;
        var refCount = Array.prototype.filter.call(doc.querySelectorAll('li[id^="ref-"]'), notInAppendix).length;
        /* 床は確認事実数と参考文献数に比例させる。固定の絶対下限を置くと、調査規模の小さい
           構成（ライト版や「普通」の少数WP案件など）で目標どおり書いても達成不能になり、水増しを強要してしまう */
        var floor85 = Math.round(0.85 * 120 * total);
        var floorSrc = 80 * refCount;
        var goal = Math.max(floor85, floorSrc);
        addResult(results, len >= goal, "本文の分量が床（85%目標・参考文献数×80字のうち大きい方）を満たしている",
          "本文 " + len + " 字（sup除く） / 床 " + goal + " 字（85%目標 " + floor85 + "字・参考文献数×80字 " + floorSrc + "字のうち大きい方）" +
          (len >= goal ? "" : "。目安に届いていませんが、このままでも完成できます。増補する場合は、この行の「詳細」を開いて全文をコピーし、AIチャットに「本文を増補して該当PARTを出し直して」と添えて送ってください（黄色の行は「不備をコピー」に含まれません）"),
          { kind: len >= goal ? "ok" : "warn",
            title: len >= goal ? "本文の分量は目安を満たしています"
                               : "本文が目安より短めです（現在 " + len.toLocaleString("ja-JP") + "字／目安 " + goal.toLocaleString("ja-JP") + "字）。そのままでも完成できます",
            next: len >= goal ? "" : "任意: AIに「本文を増補して」と送る" });
      }
      // 17. rr:confirmed-count と本文ID（引用C ∪ UNCITED）の整合
      var ids = citedClaimSet(doc);
      parseUncited(html).entries.forEach(function (e) { if (/^C-/.test(e.id)) ids[e.id] = true; });
      var union = Object.keys(ids).length;
      var okc = union === total;
      var d17 = "";
      var missingIds = [];
      /* PART 1のPLANコメントから「本文に載るはずのID全体」を復元する。実走で、欠落25件を
         件数だけ伝えたところ、AIは全6PARTを出し直しても同じ25件を落としたままだった
         （どのIDが欠けているか知りようがない）。以降はIDを実名で返す。
         列挙は打ち切らない——12件だけ挙げれば12件だけ直る、を再生産するため。
         PLANの割当自体が確認済み件数と一致していない（plan17.count !== total）ときは
         「PLANの外＝超過」の判定が信用できない（正当な主張をPLAN不足のせいで
         「削れ」と指示してしまう事故になる）ため、その場合は超過IDの個別列挙をせず
         17bの割当修正へ誘導する */
      var plan17 = parsePlan(html);
      var planTrustworthy = plan17.present && plan17.count && plan17.count === total;
      if (!okc && union > total) {
        var over;
        if (planTrustworthy) {
          over = sortIds(Object.keys(ids).filter(function (id) { return !plan17.all[id]; }));
        } else {
          /* PLANが無い・信用できない旧レポート向けの推定。/^C-(\d+)$/ はlite形式（C-12）
             専用で、フル版の C-2-7 では常に -1 になり何も挙がらない（既知の制約） */
          var numOf = function (id) { var m = String(id).match(/^C-(\d+)$/); return m ? parseInt(m[1], 10) : -1; };
          over = Object.keys(ids).filter(function (id) { return numOf(id) > total; }).sort(function (a, b) { return numOf(a) - numOf(b); });
        }
        d17 = "本文またはUNCITED行に、確認済みでないClaim IDが " + (union - total) + " 件混ざっています。" +
          (plan17.present && plan17.count && !planTrustworthy
            ? "PLANの割当件数（" + plan17.count + "件）が確認済み件数（" + total + "件）と合っていないため、超過IDを個別には特定できません。" +
              "まずこの下の「PLANコメントに確認済み主張が過不足なく割り当てられている」を直してください。"
            : (over.length ? "確認済みの範囲を超えているID: " + over.join(", ") + "。" : "") +
              "次のどちらかで直してください: (1) これらのIDを引いている文とUNCITED行の記載を削る（対応する主張は本文から外す）、" +
              "または (2) それらが本当に確認済みなら head の rr:confirmed-count を実際の件数へ直す。" +
              "該当PARTと最終PARTを丸ごと出し直してください。");
      } else if (!okc) {
        if (planTrustworthy) {
          missingIds = sortIds(Object.keys(plan17.all).filter(function (id) { return !ids[id]; }));
        }
        /* missingIdsが取れる（PLANが信用できる）場合は、その件数を主文にも使う。
           total-union は「超過が同時に混ざっている」場合に過小な値になりうる
           （例: 1件欠落＋1件混入で差引ゼロに見えてしまう）ため、PLANという
           実データが取れているときはそちらを優先する */
        var shortfall = (planTrustworthy && missingIds.length) ? missingIds.length : (total - union);
        d17 = shortfall + " 件の主張が本文にもUNCITEDにも現れていません。" +
          "未記載の主張を本文に組み込んで引用するか、UNCITED行へ理由付きで加えて、該当PARTを出し直してください。";
        if (missingIds.length) {
          d17 += "欠けている主張ID（全 " + missingIds.length + " 件）: " + missingIds.join(", ") +
            "。これらをPLANコメントで割り当てた章の本文に書き入れ、その文に [[資料ID|C-ID]] を付けてください" +
            "（列挙は省略していません。1件残らず組み込むか、5%以内ならUNCITED行へ理由付きで加えてください）。";
        } else if (plan17.present && plan17.count && !planTrustworthy) {
          d17 += "PLANの割当件数が確認済み件数と合っていないため、欠けているIDを個別には特定できません。" +
            "まずこの下の「PLANコメントに確認済み主張が過不足なく割り当てられている」を直してください。";
        } else if (!plan17.present || !plan17.count) {
          d17 += "PART 1のPLANコメントが読み取れないため、欠けているIDをこちらでは特定できません。" +
            "この会話の確認済みID一覧（監査メモのLOCK行／SCRIPT Vの結果）と、本文で引用したID＋UNCITED行のIDを突き合わせ、" +
            "欠けているIDを列挙してから直してください。";
        }
      }
      /* 2026-09-02（オーナー判断）: 主張IDの差分が片側だけ（欠落のみ、または超過のみ）で、
         かつUNCITED上限（max(1,5%)）以内・原因IDを実名で特定できている場合は黄に落とす
         （AIへは送らない。IDは画面のtitleへそのまま表示する）。実走で、引用率80%要件を
         満たす3%の欠落（207件中6件）がそのまま赤としてAIに送られ、出し直しを招いていた。
         両方混在・上限超過・PLAN不信頼で特定できない場合は従来どおり赤のまま送る */
      var uncitedCap17 = Math.max(1, Math.floor(total * 0.05));
      var mild17 = false;
      if (!okc) {
        if (union > total) {
          mild17 = planTrustworthy && !!over && over.length > 0 && over.length === (union - total) && over.length <= uncitedCap17;
        } else {
          mild17 = planTrustworthy && missingIds.length > 0 && missingIds.length === (total - union) && missingIds.length <= uncitedCap17;
        }
      }
      addResult(results, okc, "確認済み件数（rr:confirmed-count）と本文の主張ID数が一致している",
        d17 + "本文で引用・UNCITEDに挙げた主張ID " + union + " 件 / 確認済み " + total + " 件",
        { kind: mild17 ? "warn" : undefined,
          title: okc ? "確認済み件数と本文の記載が一致しています"
                     : mild17 ? "確認した事実の件数が本文とわずかに合いません（本文 " + union + "件／確認済み " + total + "件。差分ID: " +
                         (union > total ? over.join(", ") : missingIds.join(", ")) + "）。5%以内のため、そのままでも完成できます"
                     : "確認した事実の件数が本文と合いません（本文 " + union + "件／確認済み " + total + "件）",
          missingIds: missingIds,
          next: okc ? "" : mild17 ? "任意: 差分IDを本文かUNCITED行へ追記" : "AIに「不備をコピー」の文面を送る" });

      /* 17b. PLANコメント（章への主張割当）の整合。両KITは「確認済み主張の全IDを
         どれかの章にちょうど1回ずつ割り当てる」と定めており、割当漏れがそのまま
         引用漏れになる（実走: 25件が本文にもUNCITEDにも現れなかった上流原因）。
         ただしPLANの欠落・不足それ自体は、本文の引用が足りている限り実害が無い
         （割当を書かずに全件引用したレポートを赤にしても直すものが無い）。
         そこで「本文側が既に不足している（okc偽）」ときだけ、その原因として報告する。
         これによりPLANを持たない旧レポート・合成テストを赤にしない */
      if (!okc) {
        var planIssues = [];
        if (!plan17.present || !plan17.count) {
          planIssues.push("PART 1の目次直後に章計画コメント（<!-- PLAN sec-N: 章題 | C-… -->）がありません");
        } else {
          if (plan17.count !== total) {
            planIssues.push("PLANに割り当てられた主張は " + plan17.count + " 件で、確認済み " + total + " 件と一致しません" +
              (plan17.count < total ? "（" + (total - plan17.count) + " 件が どの章にも割り当てられていません）" : ""));
          }
          if (plan17.dup.length) {
            planIssues.push("複数の章に重複して割り当てられたID: " +
              sortIds(plan17.dup).map(function (id) { return plan17.raw[id] || id; }).join(", "));
          }
        }
        var planOk = planIssues.length === 0;
        addResult(results, planOk, "PLANコメントに確認済み主張が過不足なく割り当てられている",
          (planOk ? "" : planIssues.join("。") +
            "。PART 1のPLAN行を、確認済み主張の全IDがちょうど1回ずつどれかの章に入るよう直し、PART 1を丸ごと出し直してください。" +
            "割当が漏れた主張は本文にも書かれないため、引用漏れの原因になります。") +
          "PLANの割当 " + (plan17.present ? plan17.count : 0) + " 件 / 確認済み " + total + " 件",
          { title: planOk ? "章ごとの割当は確認済み件数と一致しています"
                          : "章ごとの割当が確認済み件数と合いません（割当 " + (plan17.present ? plan17.count : 0) + "件／確認済み " + total + "件）",
            next: planOk ? "" : "AIに「不備をコピー」の文面を送る" });
      }
    }

    // 18. 重複ランドマーク（PARTの取り違え・二重結合の最後の砦）。§19.2の骨格では
    //     次の要素はレポート全体で1つだけなので、2つ以上あれば別レポート／古い分割の
    //     PARTが混ざっている。ユーザー側（貼り付け）で直す問題なのでAIには送らない
    var LANDMARKS = [".cover", "#sec-exec", ".body-columns", "#sec-method",
      "#references", "#apx-a", "#apx-b", ".disclaimer"];
    /* この行はユーザーだけが読む（local:true でAIには送らない）ので、CSSの選択子ではなく
       レポート上の呼び名で知らせる */
    var LANDMARK_NAMES = { ".cover": "表紙", "#sec-exec": "エグゼクティブサマリー", ".body-columns": "本文",
      "#sec-method": "調査手法", "#references": "参考文献", "#apx-a": "付録A", "#apx-b": "付録B", ".disclaimer": "免責" };
    var dupSel = LANDMARKS.filter(function (sel) { return doc.querySelectorAll(sel).length > 1; });
    /* 章（<section id="sec-N">）の重複も見る。同一内容の重複はR6（autoRepair）が
       ここへ来る前に1つへ統合済みなので、ここに残るのは内容が異なる重複だけ
       ——AI自身が同じ章を書き直した／別内容で再出力した可能性がある */
    var secSeen = {};
    Array.prototype.forEach.call(doc.querySelectorAll('section[id^="sec-"]'), function (sec) {
      var id = sec.getAttribute("id") || "";
      if (!id) return;
      if (secSeen[id]) { if (dupSel.indexOf(id) < 0) dupSel.push(id); }
      else secSeen[id] = true;
    });
    addResult(results, dupSel.length === 0, "同じ部分が2回入っていない（表紙・調査手法・参考文献・付録・免責）",
      dupSel.length ? "2回入っている部分: " + dupSel.map(function (sel) { return LANDMARK_NAMES[sel] || sel; }).join("、") +
        "。別のレポートのPART、または分割が変わる前のPARTが混ざっている可能性があります。「クリア」してから全PARTを貼り直してください。" : "",
      { kind: dupSel.length ? "action" : "ok", local: true,
        title: dupSel.length ? "同じ章が2回入っています（PARTの取り違えの可能性）" : "同じ章の重複はありません",
        next: dupSel.length ? "「クリア」を押して、全PARTを貼り直す" : "",
        dupSelectors: dupSel });

    // 19. 展開されずに残った短い記法。資料IDの書式違い・URL欠落などで expandCompact が
    //     素通しにした分で、そのまま印刷すると本文に [[…]] や R| の行が出てしまう
    var clone19 = doc.body.cloneNode(true);
    Array.prototype.forEach.call(clone19.querySelectorAll("script, style"), function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    /* 内側が「資料ID;資料ID」または「|」を含む形だけを未展開の圧縮記法とみなす。
       これが無いと本文中の正当な「[[重要]]」のような強調表記まで赤にしてしまう */
    var leftCites = ((clone19.textContent || "").match(/\[\[[^\[\]\n]{1,400}\]\]/g) || []).filter(function (t) {
      var inner = t.slice(2, -2);
      return inner.indexOf("|") !== -1 || /^[0-9A-Za-z-]+(;[0-9A-Za-z-]+)*$/.test(inner);
    });
    /* .references ol / .appendix ol の子だけでなく、body全体のテキストノードを見る。
       AIが class を落とす／<ol>を省略すると生の R| 行がそこに残るため */
    var leftRefs = [];
    (function walkR(nd) {
      if (nd.nodeType === 3) {
        String(nd.textContent || "").split("\n").forEach(function (ln) {
          if (/^\s*R\|/.test(ln)) leftRefs.push(ln.trim().slice(0, 60));
        });
      } else if (nd.nodeType === 1 && !/^(SCRIPT|STYLE)$/.test(nd.tagName)) {
        Array.prototype.forEach.call(nd.childNodes, walkR);
      }
    })(doc.body);
    var ok19 = !leftCites.length && !leftRefs.length;
    addResult(results, ok19, "引用・参考文献の短い記法（[[…]]・R|行）がすべて展開されている",
      ok19 ? "" :
        (leftCites.length ? "展開できなかった引用 " + leftCites.length + " 件: " + leftCites.slice(0, 5).join(", ") : "") +
        (leftRefs.length ? (leftCites.length ? "／" : "") + "展開できなかった参考文献行 " + leftRefs.length + " 件: " + leftRefs.slice(0, 3).join(" ／ ") : "") +
        "。資料IDは英数字とハイフンだけにし、参考文献行は R|資料ID|種別|書誌|URL（URLは http:// か https:// で始まる）の形にして、該当PARTを出し直してください",
      { title: ok19 ? "引用・参考文献の記法はすべて展開できました"
                    : "展開できない引用・参考文献の記法が残っています（資料IDかURLの書式誤り）" });

    // 20. 結果一覧（付録C・任意貼付）との整合。貼っていなければ何も出さない。
    //     常にlocal:trueかつkind:warn/log（AIには送らない。issueTextの対象外）——
    //     この検査はAIの出力の不備ではなく、貼り付けた結果一覧との突き合わせ情報
    if (info.resultList && info.resultList.length) {
      var rlClaims = [];
      info.resultList.forEach(function (b) { (b.claims || []).forEach(function (c) { rlClaims.push({ block: b, claim: c }); }); });
      if (rlClaims.length) {
        var rlCited = citedClaimSet(doc);
        var rlUncitedIds = {};
        parseUncited(html).entries.forEach(function (e) { rlUncitedIds[e.id] = true; });
        var rlMissing = rlClaims.filter(function (bc) {
          var id = ledgerClaimId(bc.block, bc.claim);
          return !rlCited[id] && !rlUncitedIds[id];
        });
        var rlNoExcerpt = rlClaims.filter(function (bc) { return /\d/.test(bc.claim.value || "") && !bc.claim.excerpt; });
        addResult(results, rlMissing.length === 0, "結果一覧との整合（付録C・任意貼付）",
          "結果一覧のC行 " + rlClaims.length + " 件のうち、本文にもUNCITEDにも現れないもの " + rlMissing.length + " 件" +
            (rlMissing.length ? "：" + rlMissing.map(function (bc) { return ledgerClaimId(bc.block, bc.claim); }).join(", ") : "") + "。" +
            "数値を含むのに抜粋欄が空の行 " + rlNoExcerpt.length + " 件。",
          { kind: rlMissing.length ? "warn" : "log", local: true,
            title: rlMissing.length ? "貼り付けた結果一覧の主張が本文に反映されていないものがあります"
                                     : "貼り付けた結果一覧の主張はすべて本文に反映されています" });
      }
    }
  }

  function sanitizeForFilename(s) {
    return s.replace(/[\\\/:*?"<>|]/g, "").replace(/\s+/g, "").trim();
  }

  /* レポートHTMLからファイル名・PDFタイトルの元になる要素（テーマ・日付・調査ID）を
     取り出す。suggestFilename と pdfTitle の両方がこれを使う（規則を1箇所にまとめる） */
  function reportMeta(html) {
    try {
      var doc = new DOMParser().parseFromString(html, "text/html");
      var idEl = doc.querySelector('meta[name="rr:research-id"]');
      var dateEl = doc.querySelector('meta[name="DC.date"]');
      var titleEl = doc.querySelector("title");
      var researchId = idEl ? (idEl.getAttribute("content") || "") : "";
      var dateStr = dateEl ? (dateEl.getAttribute("content") || "") : "";
      var titleText = titleEl ? (titleEl.textContent || "") : "";
      /* 「｜ResearchRobo」サフィックスを先に外してから「（…調査）」を外す。
         逆順だと（…調査）の右にある｜ResearchRobo部分が正規表現の$に阻まれず
         残ってしまい、ファイル名に元号や年月が二重に付く */
      var theme = titleText
        .replace(/\s*[|｜／/]\s*ResearchRobo\s*$/i, "")
        .replace(/[（(]\s*\d{4}\s*[-年/.]\s*\d{1,2}\s*月?\s*調査[^）)]*[）)]\s*$/, "")
        .replace(/[（）()「」『』【】〈〉《》]/g, "")
        .trim();
      var ymd = dateStr.replace(/-/g, "");
      return { theme: theme, ymd: /^\d{8}$/.test(ymd) ? ymd : "", researchId: researchId };
    } catch (e) {
      return { theme: "", ymd: "", researchId: "" };
    }
  }

  function suggestFilename(html) {
    var m = reportMeta(html);
    var parts = [];
    if (m.ymd) parts.push(m.ymd);
    if (m.theme) parts.push(sanitizeForFilename(m.theme).slice(0, 24));
    if (m.researchId) parts.push(sanitizeForFilename(m.researchId));
    var name = parts.join("_");
    return (name || "research-robo-report") + ".html";
  }

  /* PDF保存（印刷）時にブラウザへ渡すページタイトル。拡張子は付けない
     （OS/ブラウザの「名前を付けて保存」ダイアログがこれをファイル名の初期値にする）。
     形式は YYMMDD_調査名（例: 260830_EV充電網）。日付を先頭に置くと保存先で
     時系列に並ぶ。reportMeta は8桁のまま返す（suggestFilename が使うため）ので、
     ここで2桁年に落とす */
  function pdfTitle(html) {
    var m = reportMeta(html);
    var parts = [];
    if (m.ymd) parts.push(m.ymd.slice(2));
    if (m.theme) parts.push(sanitizeForFilename(m.theme).slice(0, 40));
    var name = parts.join("_");
    return name || "research-robo-report";
  }

  function downloadHtml(html) {
    var filename = suggestFilename(html);
    var blob = new Blob([html], { type: "text/html;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  var RRChecks = {
    BANNED_WORDS: BANNED_WORDS,
    BANNED_WORDS_FULL: BANNED_WORDS_FULL,
    BANNED_WORDS_LITE: BANNED_WORDS_LITE,
    BANNED_HEADING_WORDS_LITE: BANNED_HEADING_WORDS_LITE,
    parsePlan: parsePlan,
    sortIds: sortIds,
    PRIMARY_TYPES: PRIMARY_TYPES,
    normalizeInput: normalizeInput,
    bodyTextForScan: bodyTextForScan,
    runChecks: runChecks,
    runStructureChecks: runStructureChecks,
    normalizeRefUrl: normalizeRefUrl,
    digitsOf: digitsOf,
    dateKeys: dateKeys,
    toHalfDigits: toHalfDigits,
    normResultListLine: normResultListLine,
    MULTI_TLD: MULTI_TLD,
    domainOf: domainOf,
    etld1: etld1,
    notInAppendix: notInAppendix,
    citedClaimSet: citedClaimSet,
    parseUncited: parseUncited,
    parseResultList: parseResultList,
    looksLikeResultList: looksLikeResultList,
    buildLedgerHtml: buildLedgerHtml,
    parseParts: parseParts,
    MAX_PARTS: MAX_PARTS,
    partStatus: partStatus,
    assembleParts: assembleParts,
    partIdentity: partIdentity,
    identityMatch: identityMatch,
    partSetPlan: partSetPlan,
    ensureStyle: ensureStyle,
    renumberRefs: renumberRefs,
    expandCompact: expandCompact,
    autoRepair: autoRepair,
    computeReportStats: computeReportStats,
    fillTokens: fillTokens,
    statTile: statTile,
    coverageCardHtml: coverageCardHtml,
    coverStatsHtml: coverStatsHtml,
    TOKEN_NAMES: TOKEN_NAMES,
    TOKEN_ALIASES: TOKEN_ALIASES,
    typeCode: typeCode,
    isV51: isV51,
    coverLines: coverLines,
    coverValue: coverValue,
    metaContent: metaContent,
    sanitizeForFilename: sanitizeForFilename,
    suggestFilename: suggestFilename,
    pdfTitle: pdfTitle,
    downloadHtml: downloadHtml
  };

  if (typeof window !== "undefined") window.RRChecks = RRChecks;
  if (typeof module !== "undefined" && module.exports) module.exports = RRChecks;
})();
