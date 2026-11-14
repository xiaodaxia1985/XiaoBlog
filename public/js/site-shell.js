/* 站点外壳：跨页跳转进度条 + 图片解码后淡入。约 0.8KB，defer 加载，不依赖框架。
   无 JS 时：无进度条，图片直接显示（.js 守卫），站内跳转照常。 */
(function () {
  var docEl = document.documentElement;
  if (!docEl.classList.contains('js')) docEl.classList.add('js');

  /* ---- 顶部细进度条 ---- */
  var bar = null;

  function ensureBar() {
    if (bar && bar.isConnected) return bar;
    if (bar && !bar.isConnected) bar = null;
    bar = document.createElement('div');
    bar.className = 'nav-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    return bar;
  }

  function hideBar() {
    if (!bar) return;
    bar.classList.remove('is-active');
    bar.style.width = '0';
  }

  // 只在“真的会换文档”的站内链接上出现：同页 hash、同页查询参数、外链、下载、新窗口都不触发。
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var link = event.target.closest ? event.target.closest('a[href]') : null;
    if (!link) return;
    if (link.target && link.target !== '_self') return;
    if (link.hasAttribute('download')) return;
    var url;
    try {
      url = new URL(link.href, location.href);
    } catch (error) {
      return;
    }
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search) return;
    var el = ensureBar();
    el.classList.add('is-active');
    el.style.width = '0';
    // 下一帧再给宽度，保证过渡从 0 开始。
    requestAnimationFrame(function () {
      el.style.width = '70%';
    });
  }, true);

  /* ---- 跳转链接：不只改 hash，把焦点真正移到正文 ---- */
  document.addEventListener('click', function (event) {
    var link = event.target.closest ? event.target.closest('.skip-link') : null;
    if (!link) return;
    var id = (link.getAttribute('href') || '').slice(1);
    var target = id && document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: false });
    history.replaceState(null, '', '#' + id);
  });

  // 新页首帧、后退恢复（bfcache）都清除状态。
  window.addEventListener('pageshow', hideBar);
  window.addEventListener('hashchange', hideBar);
  // Astro ClientRouter keeps the document alive and swaps body content.
  // Rebind page-scoped visual behavior after each in-app navigation.
  // 客户端导航会用新文档属性重置 <html>，丢掉 class="js"；
  // head 里补类的内联脚本又被 Astro 去重不再执行，swap 后立即补回，避免样式闪崩一帧。
  document.addEventListener('astro:after-swap', function () {
    if (!docEl.classList.contains('js')) docEl.classList.add('js');
  });
  document.addEventListener('astro:page-load', function () {
    if (bar && !bar.isConnected) bar = null;
    if (!docEl.classList.contains('js')) docEl.classList.add('js');
    hideBar();
    scan();
  });

  /* ---- 图片占位到淡入：尺寸由 width/height 或 aspect-ratio 预留 ---- */
  var selector = '.markdown img, .article-cover img, .project-img img, .project-preview img';
  var fallback = null;

  function reveal(img) {
    img.classList.add('img-ready');
  }

  function watch(img) {
    if (img.classList.contains('img-ready')) return;
    if (img.complete) {
      if (img.naturalWidth) reveal(img);
      else img.addEventListener('error', function () { reveal(img); }, { once: true });
      return;
    }
    img.addEventListener('load', function () { reveal(img); }, { once: true });
    img.addEventListener('error', function () { reveal(img); }, { once: true });
  }

  function scan() {
    Array.prototype.forEach.call(document.querySelectorAll(selector), watch);
  }

  scan();
  document.addEventListener('DOMContentLoaded', scan);
  // 客户端二次渲染插入的图片（如项目预览）同样走淡入，不额外套骨架。
  try {
    new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        Array.prototype.forEach.call(mutation.addedNodes, function (node) {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches(selector)) watch(node);
          else if (node.querySelectorAll) Array.prototype.forEach.call(node.querySelectorAll(selector), watch);
        });
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  // 兜底：任何情况下 3 秒后都不再隐藏图片。
  fallback = setTimeout(function () {
    Array.prototype.forEach.call(document.querySelectorAll(selector), reveal);
  }, 3000);
  window.addEventListener('pageshow', function () {
    if (fallback) clearTimeout(fallback);
    scan();
  });
})();
