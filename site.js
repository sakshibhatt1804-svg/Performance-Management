/* Progressive enhancement only: the pages read fully without this script. */
(function () {
  try {
    document.documentElement.classList.add("js");
    var els = document.querySelectorAll(".reveal");
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
      }, { rootMargin: "0px 0px -8% 0px" });
      els.forEach(function (el) { io.observe(el); });
      setTimeout(function () { els.forEach(function (el) { el.classList.add("in"); }); }, 2500); // never leave content hidden
    } else { els.forEach(function (el) { el.classList.add("in"); }); }
    // label table cells for the stacked mobile layout
    document.querySelectorAll("table.stack").forEach(function (t) {
      var heads = Array.prototype.map.call(t.querySelectorAll("thead th"), function (th) { return th.textContent; });
      t.querySelectorAll("tbody tr").forEach(function (tr) {
        Array.prototype.forEach.call(tr.children, function (td, i) { td.setAttribute("data-l", heads[i] || ""); });
      });
    });
  } catch (e) { document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); }); }
})();
