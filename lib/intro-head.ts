// The intro video's gate, run in <head> before the page paints. The same text is pasted into every promo page
// (public/site/*.html); keep them identical. It shows the intro on the first page of every new visit (a new tab or
// browser) and never on a refresh or when moving between pages, because sessionStorage lasts as long as the tab.
// Skipped, and remembered for the tab, for: the Home button (?home, also where Log out lands), search engine and AI
// crawlers, visitors arriving from a search engine (a full-screen intro on a search landing page counts against the
// site in Google's ranking), and phones with "Reduce motion" on.

export const INTRO_STYLE = "html.intro::before{content:'';position:fixed;inset:0;z-index:90;background:#000}html.intro{overflow:hidden}";

export const INTRO_SCRIPT = "(function(){try{var d=document.documentElement,s=sessionStorage,k='rdx-intro';if(s.getItem(k))return;" +
  "if(/[?&]home\\b/.test(location.search)||/bot|crawl|spider|slurp|preview|lighthouse|headless/i.test(navigator.userAgent)||" +
  "/^https?:\\/\\/([a-z0-9-]+\\.)*(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|perplexity|chatgpt|brave)\\./i.test(document.referrer)||" +
  "matchMedia('(prefers-reduced-motion: reduce)').matches){s.setItem(k,'1');return}" +
  "d.classList.add('intro');var j=document.createElement('script');j.src='/site/assets/js/intro.js';j.async=true;document.head.appendChild(j);" +
  "setTimeout(function(){if(!document.querySelector('.intro-layer'))d.classList.remove('intro')},8000)}catch(e){}})();";
