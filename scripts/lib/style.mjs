// Ported from ref/design-template.html; additions only support live content and archives.
export const stylesheet = `
:root{
  --bg:#ffffff; --fg:#222222; --sub:#757575; --line:#e6e6e6; --soft:#f4f4f4; --red:#e3211b; --bar:#111111; --barfg:#ffffff;
  --f:"Noto Sans JP","Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI",Meiryo,sans-serif;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#141414; --fg:#ececec; --sub:#a0a0a0; --line:#2c2c2c; --soft:#1f1f1f; --red:#ff4b42; --bar:#000000; --barfg:#ffffff; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#141414; --fg:#ececec; --sub:#a0a0a0; --line:#2c2c2c; --soft:#1f1f1f; --red:#ff4b42; --bar:#000000; --barfg:#ffffff; color-scheme:dark}

body{background:var(--bg);color:var(--fg);font-family:var(--f);font-size:16px;line-height:1.6;margin:0}
body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);z-index:10;background:var(--bar)}
.g{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.wrap{max-width:720px;margin:0 auto}
a{color:inherit;text-decoration:none}
a:focus-visible{outline:2px solid var(--red);outline-offset:2px}
img{display:block;max-width:100%}

.logo{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-block:12px}
.logo h1{margin:0;font-size:1.45rem;font-weight:900;letter-spacing:.02em;line-height:1}
.logo h1 span{color:var(--red)}
.logo time{font-size:.78rem;color:var(--sub);font-weight:500;text-align:right;line-height:1.35}

.tabs{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;background:var(--bar)}
.tabs .wrap{display:flex;overflow-x:auto;scrollbar-width:none}
.tabs .wrap::-webkit-scrollbar{display:none}
.tabs a{color:var(--barfg);font-weight:700;font-size:.9rem;padding:11px 14px;white-space:nowrap;border-bottom:3px solid transparent;opacity:.85}
.tabs a.on{border-bottom-color:var(--red);opacity:1}

.top{padding-block:16px 4px}
.top .pic{aspect-ratio:1.91/1;width:100%;object-fit:cover;background:var(--soft);border-radius:4px}
.top h2{font-size:1.38rem;font-weight:900;line-height:1.45;margin:12px 0 6px;text-wrap:pretty}
.top p{margin:0 0 8px;font-size:.95rem;color:var(--fg)}

.sec{padding-top:26px}
.sec>h2{font-size:1.2rem;font-weight:900;margin:0;padding-bottom:8px;border-bottom:1px solid var(--line);position:relative}
.sec>h2::after{content:"";position:absolute;left:0;bottom:-1px;width:44px;height:3px;background:var(--red)}

.item{display:grid;grid-template-columns:minmax(0,1fr) 112px;gap:12px;padding:14px 0;border-bottom:1px solid var(--line)}
.item .th{width:112px;aspect-ratio:1.91/1;object-fit:cover;border-radius:4px;background:var(--soft)}
.item h3{font-size:1.02rem;font-weight:700;line-height:1.5;margin:0 0 4px}
.item p{margin:0 0 6px;font-size:.86rem;line-height:1.65;color:var(--sub)}
.item .txt{min-width:0}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;font-size:.74rem;color:var(--sub)}
.meta .src{font-weight:700;color:var(--fg)}
.impact{margin:4px 0 6px;font-size:.82rem;line-height:1.6;background:var(--soft);padding:6px 10px;border-left:3px solid var(--red)}

.links{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.links a{font-size:.76rem;font-weight:700;line-height:1;padding:7px 12px;border:1px solid var(--line);border-radius:999px;background:var(--bg)}
.links a::after{content:" ↗";font-weight:400}
.links a.d{color:var(--red);border-color:var(--red)}

.rank .item{grid-template-columns:28px minmax(0,1fr) 92px}
.rank .item .th{width:92px}
.rk{font-size:1.4rem;font-weight:900;line-height:1.2;color:var(--red);text-align:center}
.rank .item:nth-child(n+4) .rk{color:var(--sub)}
.star{font-weight:700;color:var(--fg)}
.nothumb{width:92px;aspect-ratio:1.91/1;border-radius:4px;background:var(--soft);display:grid;place-items:center;font-size:.7rem;color:var(--sub);font-weight:700}

.brief{list-style:none;margin:0;padding:0}
.brief li{padding:12px 0;border-bottom:1px solid var(--line)}
.brief b{display:block;font-size:.98rem;line-height:1.5;margin-bottom:2px}
.brief span{font-size:.84rem;color:var(--sub)}

footer{padding-block:22px 40px;font-size:.74rem;color:var(--sub);line-height:1.7}
footer p{margin:0 0 6px}
.logo .date{display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:.74rem;color:var(--sub)}
.logo .date>a,footer a,.archive a{text-decoration:underline;text-underline-offset:3px}
.logo .language{font-size:.72rem;white-space:nowrap}
html[lang="en"] .logo h1{font-size:1.3rem;line-height:1.2}
@media(max-width:420px){html[lang="en"] .logo{align-items:flex-start}html[lang="en"] .logo h1{max-width:145px}}
.notice{background:var(--soft);border-left:3px solid var(--red);padding:12px;font-size:.86rem;margin:16px 0}
.empty{padding-block:30px;color:var(--sub)}
.hf{margin-top:20px}
.hf h3{font-size:.95rem;margin:0 0 4px}
.hf ul,.archive{list-style:none;margin:0;padding:0}
.hf li,.archive li{padding:10px 0;border-bottom:1px solid var(--line)}
.hf a{font-size:.88rem;font-weight:700}
.nothumb{box-sizing:border-box;text-align:center;padding:6px;overflow:hidden}
.top,.sec{scroll-margin-top:70px}
.txt,.top h2,.top p,.brief,.hf,.nothumb{overflow-wrap:anywhere}
`;

export const tabScript = `(function(){
  var tabs=[].slice.call(document.querySelectorAll('.tabs a'));
  var ids=tabs.map(function(a){return a.getAttribute('href').slice(1)});
  function mark(){var y=window.scrollY+120,cur=ids[0];ids.forEach(function(id){var el=document.getElementById(id);if(el&&el.getBoundingClientRect().top+window.scrollY<=y)cur=id});
    tabs.forEach(function(a){var on=a.getAttribute('href')==='#'+cur;a.classList.toggle('on',on);if(on&&a.scrollIntoView&&a.parentNode.scrollWidth>a.parentNode.clientWidth){var p=a.parentNode;p.scrollLeft=a.offsetLeft-16}})}
  window.addEventListener('scroll',mark,{passive:true});mark();
})();`;
