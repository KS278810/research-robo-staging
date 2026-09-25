/* ResearchRobo レポート書式CSS（viewer.html が使う。dispatch.html は v5.2 で組版機能を
   削除したため読み込まない）。KIT §24.2 のCSSを移設し、表紙Coverage Card・付録・
   表紙6タイルの折り返しを追加したもの。ブラウザ内だけで使う純データ。 */
(function () {
  "use strict";

  var REPORT_CSS = [
    ':root{--ink:#1E2126;--accent:#12263A;--sub:#5C636E;--hair:#C7CBD2;}',
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
    'table{width:100%;border-collapse:collapse;margin:4mm 0;font-size:9.5pt;border-top:1.2pt solid var(--ink);border-bottom:1.2pt solid var(--ink);font-variant-numeric:tabular-nums;}',
    'thead{display:table-header-group;}',
    'tr,li{break-inside:avoid;}',
    'th,td{border:none;padding:2mm 3mm;text-align:left;vertical-align:top;}',
    'th{border-bottom:0.8pt solid var(--ink);background:none;color:var(--ink);font-size:9pt;}',
    'td{border-bottom:0.4pt solid var(--hair);}',
    'tbody tr:last-child td{border-bottom:none;}',
    'td.num,th.num{text-align:right;}',
    '.stat-row{display:flex;gap:4mm;margin:4mm 0;break-inside:avoid;}',
    '.stat{flex:1;border:0.5pt solid var(--hair);border-top:2pt solid var(--accent);padding:3mm 4mm;}',
    '.stat .n{font-size:18pt;font-weight:700;color:var(--accent);line-height:1.2;}',
    '.stat .l{font-size:8.5pt;color:var(--sub);}',
    'sup{line-height:0;}',
    'sup a{color:var(--sub);text-decoration:none;font-weight:400;font-size:7.5pt;}',
    '@media print{a{color:inherit;}}',
    'figure{break-inside:avoid;margin:4mm 0;text-align:center;counter-increment:figc;}',
    'figure svg{max-width:100%;}',
    'figcaption{font-size:9pt;color:var(--sub);margin-top:2mm;}',
    'figcaption::before{content:"図表" counter(figc) "　";font-weight:700;color:var(--accent);}',
    '.body-columns{counter-reset:h2c figc;column-count:2;column-gap:9mm;column-rule:0.25pt solid var(--hair);}',
    '.body-columns h2{counter-increment:h2c;counter-reset:h3c;column-span:all;}',
    '.body-columns h2::before{content:counter(h2c) ".\\2002";font-family:"Helvetica Neue",Arial,sans-serif;color:var(--accent);}',
    '.body-columns h3{counter-increment:h3c;}',
    '.body-columns h3::before{content:counter(h2c) "." counter(h3c) "\\2002";font-family:"Helvetica Neue",Arial,sans-serif;color:var(--accent);}',
    '.body-columns table,.body-columns figure{column-span:all;}',
    /* 2026-09-03(7回目・初実走FB): body全体のpalt（プロポーショナル詰め）が「」等の
       約物の左余白を詰め、直前の欧文1文字と重なって「OpenA「I …」」のように文字化けして
       見えた（実走で確認）。書誌欄だけpaltを無効化する */
    '.references,.appendix{font-feature-settings:normal;}',
    '.references{break-before:page;margin-top:8mm;}',
    '.references ol{column-count:2;column-gap:10mm;font-size:8.5pt;color:var(--sub);padding-left:5mm;}',
    '.references li{break-inside:avoid;margin-bottom:3mm;overflow-wrap:anywhere;}',
    '.references a{color:var(--accent);}',
    '.disclaimer{margin-top:10mm;font-size:8.5pt;color:var(--sub);border-top:0.4pt solid var(--hair);padding-top:3mm;}',
    '@media screen{body{max-width:1100px;margin:0 auto;padding:24px;}}',
    /* 表紙Coverage Card・付録 */
    '.cover .stat-row{max-width:200mm;margin-top:8mm;flex-wrap:wrap;}',
    '.cover .stat .n{font-size:14pt;}',
    '.appendix{break-before:page;margin-top:8mm;}',
    '.appendix ol,.appendix ul{column-count:2;column-gap:10mm;font-size:8.5pt;color:var(--sub);padding-left:5mm;}',
    '.appendix li{break-inside:avoid;margin-bottom:2mm;overflow-wrap:anywhere;}',
    '.appendix a{color:var(--accent);}',
    /* 付録C 主張台帳（結果一覧を任意貼付したときだけ生成される）。列数が多く
       原文抜粋が長くなりがちなので、通常の本文表より小さいフォント・行間にする */
    '#apx-c table{font-size:7.5pt;}',
    '#apx-c td,#apx-c th{padding:1.2mm 2mm;overflow-wrap:anywhere;}',
    '#apx-c .note{font-size:8pt;color:var(--sub);}',
    '#apx-c .rr-grade{text-align:center;font-weight:700;}',
    '#apx-c .rr-grade-D{color:var(--sub);}',
    /* 表紙6タイルの折り返し（A4横ではみ出さない。max-widthを200mmへ広げたので6枚は2段に
       折り返さず収まるが、将来タイル数が増えても崩れないよう最小幅を残しておく） */
    '.stat-row .stat{min-width:28mm}'
  ].join("\n");

  var RRReportCss = { REPORT_CSS: REPORT_CSS, CSS_VERSION: "5.2" };
  if (typeof window !== "undefined") window.RRReportCss = RRReportCss;
  if (typeof module !== "undefined" && module.exports) module.exports = RRReportCss;
})();
