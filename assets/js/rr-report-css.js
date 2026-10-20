/* ResearchRobo レポート書式CSS（viewer.html が使う。dispatch.html は v5.2 で組版機能を
   削除したため読み込まない）。KIT §24.2 のCSSを移設し、表紙Coverage Card・付録・
   表紙6タイルの折り返しを追加したもの。ブラウザ内だけで使う純データ。 */
(function () {
  "use strict";

  var REPORT_CSS = [
    /* 2026-10-15(レポートの内容とデザイン・levers監査): 補助色を #5C636E(6.06:1) → #4B525C(7.89:1, AAA)。
       表の行罫線は --hair(1.63:1) だと白黒印刷で消えるため --rule(3.22:1) を分ける */
    ':root{--ink:#1E2126;--accent:#12263A;--sub:#4B525C;--hair:#C7CBD2;--rule:#8A9099;}',
    '@page{size:A4 landscape;margin:18mm 18mm;}',
    '@page{@bottom-right{content:counter(page) " / " counter(pages);font-size:9pt;color:var(--sub);}@top-center{content:"ResearchRobo";font-size:8pt;color:var(--sub);}}',
    '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}',
    'html,body{margin:0;padding:0;}',
    'body{font-family:"Helvetica Neue",Arial,"Yu Gothic",YuGothic,"Hiragino Kaku Gothic ProN","Noto Sans JP",Meiryo,sans-serif;font-weight:500;font-size:10pt;line-height:1.65;color:var(--ink);font-feature-settings:"palt";}',
    'h2,h3,th,strong{font-weight:700;}',
    '.cover{break-after:page;display:flex;flex-direction:column;justify-content:space-between;text-align:left;padding:26mm 4mm 10mm;min-height:165mm;}',
    '.cover-head{border-top:2.5pt solid var(--accent);padding-top:3mm;font-size:10pt;font-weight:700;letter-spacing:0.35em;color:var(--accent);}',
    '.cover h1{font-family:"Yu Mincho",YuMincho,"Hiragino Mincho ProN","Noto Serif JP",serif;font-size:26pt;font-weight:600;color:var(--ink);line-height:1.45;margin:0;max-width:200mm;letter-spacing:0.02em;}',
    '.cover-meta{max-width:120mm;font-size:9.5pt;color:var(--ink);}',
    '.cover-meta p{margin:0;padding:1.6mm 0;border-top:0.4pt solid var(--hair);line-height:1.5;}',
    '.exec-summary{border-top:1.6pt solid var(--accent);border-bottom:0.4pt solid var(--hair);padding:4mm 0 5mm;margin:0 0 8mm;break-inside:avoid;}',
    '.exec-summary h2{margin:0 0 3mm;font-size:12pt;color:var(--ink);border:none;padding:0;}',
    '.exec-summary .headline{font-size:12pt;font-weight:700;color:var(--accent);margin:0 0 3mm;line-height:1.6;}',
    '.exec-summary ul{margin:0;padding-left:5mm;}',
    '.exec-summary li{margin-bottom:1.5mm;}',
    '.structure-box{border-top:0.4pt solid var(--hair);padding:3mm 0 0;margin:0 0 8mm;}',
    '.structure-box h2{margin:0 0 2mm;font-size:10pt;letter-spacing:0.08em;color:var(--sub);border:none;padding:0;}',
    '.structure-box ol{margin:2mm 0 0;padding-left:5mm;}',
    /* 2026-09-03(7回目・初実走FB): 目次の調査手法・対象範囲(#sec-method)はbody-columns
       の外にあり見出し自体には章番号が付かないため、目次側だけ数字が付くと対応が
       取れなくなる（実走で確認）。この項目だけ番号を消す */
    '.toc li:has(a[href="#sec-method"]){list-style:none;}',
    'h2{font-family:"Yu Mincho",YuMincho,"Hiragino Mincho ProN","Noto Serif JP",serif;font-size:14pt;font-weight:600;color:var(--ink);border-top:1.2pt solid var(--accent);padding-top:2.5mm;margin-top:10mm;break-after:avoid;}',
    'h3{font-size:11pt;color:var(--ink);font-weight:700;margin-top:6mm;break-after:avoid;}',
    '.key-message{font-weight:700;color:var(--accent);font-size:10.5pt;margin:2mm 0 4mm;padding-bottom:2mm;border-bottom:0.5pt solid var(--hair);break-after:avoid;}',
    'p.note{font-size:9pt;color:var(--sub);margin:1mm 0 3mm;}',
    'p,li{orphans:3;widows:3;}',
    '.body-columns,.exec-summary{text-align:justify;line-break:strict;}',
    /* 2026-10-16(オーナー指摘「表がださい。縦線が入り、無駄に左右に伸びている」「左寄せがださい」): 表は内容の幅に収め、
       ページ中央に置く（width:auto・margin:auto）。列の少ない表を全幅に広げると数字が左右に離れて読めない。比較表は最小幅、付録C は全幅 */
    'table{width:auto;max-width:100%;border-collapse:collapse;margin:3mm auto;font-size:9pt;line-height:1.3;border-top:1.2pt solid var(--ink);border-bottom:1.2pt solid var(--ink);font-variant-numeric:tabular-nums;}',
    'thead{display:table-header-group;}',
    'tr,li{break-inside:avoid;}',
    'th,td{border:none;padding:1mm 4.5mm 1mm 3mm;text-align:left;vertical-align:middle;}',
    'th{border-bottom:0.8pt solid var(--ink);background:none;color:var(--ink);font-size:9pt;}',
    'td{border-bottom:0.4pt solid var(--rule);}',
    'tbody tr:last-child td{border-bottom:none;}',
    'td.num,th.num{text-align:right;}',
    '.stat-row{display:flex;gap:4mm;margin:4mm 0;break-inside:avoid;}',
    '.stat{flex:1;border:0.5pt solid var(--hair);border-top:2pt solid var(--accent);padding:3mm 4mm;}',
    '.stat .n{font-size:18pt;font-weight:700;color:var(--accent);line-height:1.2;}',
    '.stat .l{font-size:8.5pt;color:var(--sub);white-space:nowrap;}',
    /* 引用記号は行をまたがない・8.5pt（7.5pt の灰色は白黒印刷で読めない） */
    'sup{line-height:0;white-space:nowrap;}',
    'td sup{vertical-align:baseline;}',
    /* 参考文献の日付（YYYY-MM-DD）は折り返さない（ハイフンの位置で「2026-/04-10」と割れていた） */
    '.nb{white-space:nowrap;}',
    'sup a{color:var(--sub);text-decoration:none;font-weight:400;font-size:8.5pt;}',
    '@media print{a{color:inherit;}}',
    /* 印刷・PDF では href が見えない（URLは書誌テキストに書かない規則）ため、参考文献・付録の外部リンクに URL を添える */
    '@media print{.references a[href^="http"]::after,.appendix a[href^="http"]::after{content:attr(href);display:block;font-size:7.5pt;color:var(--sub);overflow-wrap:anywhere;word-break:normal;text-decoration:none;}}',
    'figure{break-inside:avoid;margin:4mm 0;text-align:center;counter-increment:figc;}',
    'figure svg{max-width:100%;}',
    'figcaption{font-size:9pt;color:var(--sub);margin-top:2mm;}',
    'figcaption::before{content:"図" counter(figc) "　";font-weight:700;color:var(--accent);}',
    /* 表にも番号と表題（図とは別の連番「表N」）。表は頁をまたがせない（またぐと中央値の行だけが次の頁に残る） */
    'caption{caption-side:top;text-align:center;font-size:9pt;color:var(--sub);padding-bottom:1.5mm;counter-increment:tabc;}',
    'caption::before{content:"表" counter(tabc) "　";font-weight:700;color:var(--accent);}',
    'table{break-inside:avoid;}',
    '.note{break-inside:avoid;}',
    '#apx-c table{break-inside:auto;}',
    '.body-columns{counter-reset:h2c figc tabc;column-count:2;column-gap:12mm;}',
    /* 段間の罫線はやめて余白だけにする。全幅の表を貫通して縦線が入っていた。結論文は段をまたがず全幅 */
    '.body-columns .key-message{column-span:all;}',
    /* 2026-10-16: 小見出し・注記まで全幅にすると、段組が細かく分断されて頁末に短い段と大きな空白ができた（46頁に膨らんだ実測）ため、
       全幅にするのは章見出し・結論文・表・図だけにする */
    '.body-columns h2{counter-increment:h2c;counter-reset:h3c;column-span:all;}',
    '.body-columns h2::before{content:counter(h2c) ".\\2002";font-family:"Helvetica Neue",Arial,sans-serif;color:var(--accent);}',
    '.body-columns h3{counter-increment:h3c;}',
    '.body-columns h3::before{content:counter(h2c) "." counter(h3c) "\\2002";font-family:"Helvetica Neue",Arial,sans-serif;color:var(--accent);}',
    '.body-columns table,.body-columns figure{column-span:all;}',
    /* 2026-09-03(7回目・初実走FB): body全体のpalt（プロポーショナル詰め）が「」等の
       約物の左余白を詰め、直前の欧文1文字と重なって「OpenA「I …」」のように文字化けして
       見えた（実走で確認）。書誌欄だけpaltを無効化する */
    '.references,.appendix{font-feature-settings:normal;}',
    /* 2026-10-16: 参考文献の強制改ページをやめる（見本9ページ中、直前のページが9割空になった。thead は繰り返されるので表の分割も許す） */
    '.references{break-before:auto;margin-top:8mm;}',
    '.references ol{column-count:2;column-gap:10mm;font-size:9pt;color:var(--sub);padding-left:5mm;}',
    '.references li{break-inside:avoid;margin-bottom:3mm;overflow-wrap:anywhere;}',
    '.references a{color:var(--accent);text-decoration:none;}',
    '.disclaimer{margin-top:10mm;font-size:8.5pt;color:var(--sub);border-top:0.4pt solid var(--hair);padding-top:3mm;}',
    '@media screen{body{max-width:1100px;margin:0 auto;padding:24px;}}',
    /* 狭い画面・200%拡大では段を畳む（2段のままだと1段が9字幅になり WCAG 1.4.10 の再流し込みを満たさない） */
    '@media screen and (max-width:720px){.body-columns,.references ol,.appendix ol,.appendix ul{column-count:1;}}',
    /* 表紙Coverage Card・付録 */
    '.cover .stat-row{max-width:100%;margin-top:8mm;flex-wrap:wrap;}',
    '.cover .stat .n{font-size:14pt;}',
    '.appendix{break-before:page;margin-top:8mm;}',
    '.appendix ol,.appendix ul{column-count:2;column-gap:10mm;font-size:9pt;color:var(--sub);padding-left:5mm;}',
    /* 連続する付録（A→B→C）は改ページしない。「該当なし」1行だけで1ページ使っていた */
    '.appendix+.appendix{break-before:auto;}',
    '.appendix li{break-inside:avoid;margin-bottom:2mm;overflow-wrap:anywhere;}',
    /* 付録Aは本文の参考文献（1〜）と番号が衝突しないよう A-1… と振る */
    '.appendix ol{list-style:none;counter-reset:ax;padding-left:0;}',
    '.appendix ol>li{counter-increment:ax;}',
    '.appendix ol>li::before{content:"A-" counter(ax) "　";}',
    '.appendix a{color:var(--accent);}',
    /* 付録C 主張台帳（結果一覧を任意貼付したときだけ生成される）。列数が多く
       原文抜粋が長くなりがちなので、通常の本文表より小さいフォント・行間にする */
    '#apx-c table{font-size:8pt;width:100%;}',
    '#apx-c td,#apx-c th{padding:1.2mm 2mm;overflow-wrap:anywhere;}',
    '#apx-c .note{font-size:8pt;color:var(--sub);}',
    '#apx-c .rr-grade{text-align:center;font-weight:700;}',
    '#apx-c .rr-grade-D{color:var(--sub);}',
    /* 表紙6タイルの折り返し（A4横ではみ出さない。max-widthを200mmへ広げたので6枚は2段に
       折り返さず収まるが、将来タイル数が増えても崩れないよう最小幅を残しておく） */
    '.stat-row .stat{min-width:34mm}',
    /* 比較の一覧表（対象×観点の記号表。KIT の章規則）: 記号は中央揃え */
    'table.matrix td{text-align:center;}',
    /* 表は頁をまたいでよい（またがないと表の前後の頁が大きく空き、頁数が約1.7倍に膨らんだ）。ただし見出し行は繰り返し、
       最初の2行と最後の2行（合計・中央値の行）は孤立させない */
    'tbody tr:nth-child(-n+2){break-after:avoid;}',
    'tbody tr:nth-last-child(-n+2){break-before:avoid;}',
    'figure svg{max-width:175mm;}',
    '@page :first{@top-center{content:"";}}',
    'table.matrix{min-width:62%;}',
    /* 調査手法の末尾の注記が1行だけ次ページへ落ちない */
    '#sec-method .note{break-before:avoid;}'
  ].join("\n");

  var RRReportCss = { REPORT_CSS: REPORT_CSS, CSS_VERSION: "5.2" };
  if (typeof window !== "undefined") window.RRReportCss = RRReportCss;
  if (typeof module !== "undefined" && module.exports) module.exports = RRReportCss;
})();
