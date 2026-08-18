/* ==========================================================================
   FRICON SOLUCIONES S.A.S. — Comportamiento del sitio
   Sin dependencias externas.
   ========================================================================== */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var WA = '573026234401';

  /* ------------------------------------------- Logo en video: cada 15 s */
  var marcaVideo = document.querySelector('.marca-video');
  if (marcaVideo && !reduce) {
    var CICLO = 15000;   // reinicia el logo cada 15 segundos
    var reloj = null;

    function reproducirMarca() {
      try { marcaVideo.currentTime = 0; } catch (e) {}
      var p = marcaVideo.play();
      if (p && p.catch) p.catch(function () {});
    }
    function arrancarReloj() {
      if (reloj) return;
      reloj = setInterval(reproducirMarca, CICLO);
    }
    function pararReloj() {
      if (!reloj) return;
      clearInterval(reloj);
      reloj = null;
    }

    // No malgastar ciclos si la pestaña está en segundo plano.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { pararReloj(); }
      else { reproducirMarca(); arrancarReloj(); }
    });

    // Al pasar el mouse por el logo también se repite, sin romper el ciclo.
    var marca = marcaVideo.closest('.marca');
    if (marca) marca.addEventListener('mouseenter', reproducirMarca);

    reproducirMarca();
    arrancarReloj();
  }

  /* ---------------------------------------------------------------- Menú */
  var boton = document.querySelector('.hamburguesa');
  var menu  = document.getElementById('menu-principal');

  function cerrarMenu() {
    if (!menu) return;
    menu.setAttribute('data-abierto', 'false');
    boton.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  if (boton && menu) {
    boton.addEventListener('click', function () {
      var abierto = menu.getAttribute('data-abierto') === 'true';
      menu.setAttribute('data-abierto', String(!abierto));
      boton.setAttribute('aria-expanded', String(!abierto));
      document.body.style.overflow = !abierto ? 'hidden' : '';
    });

    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) cerrarMenu();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.getAttribute('data-abierto') === 'true') {
        cerrarMenu();
        boton.focus();
      }
    });
  }

  /* ------------------------------------------- Cabecera al desplazar */
  var cab = document.querySelector('.cab');
  var barra = document.getElementById('barra-cot');
  var barraOculta = false;

  function alDesplazar() {
    var y = window.scrollY;

    if (cab) cab.setAttribute('data-fija', y > 12 ? 'true' : 'false');

    if (barra && !barraOculta) {
      // Aparece una vez que el hero queda atrás y se esconde al llegar al pie.
      var pie = document.querySelector('.pie');
      var finDoc = pie ? pie.offsetTop : document.body.scrollHeight;
      var visible = y > 520 && (y + window.innerHeight) < finDoc + 160;
      barra.setAttribute('data-visible', String(visible));
      document.body.setAttribute('data-barra', String(visible));
    }
  }

  window.addEventListener('scroll', alDesplazar, { passive: true });
  alDesplazar();

  if (barra) {
    var cerrar = barra.querySelector('.cerrar');
    if (cerrar) {
      cerrar.addEventListener('click', function () {
        barraOculta = true;
        barra.setAttribute('data-visible', 'false');
        document.body.setAttribute('data-barra', 'false');
      });
    }
  }

  /* --------------------------------------------- Revelado al desplazar */
  var revelables = document.querySelectorAll('.rev');
  if (revelables.length) {
    if (reduce || !('IntersectionObserver' in window)) {
      revelables.forEach(function (el) { el.classList.add('visible'); });
    } else {
      var obs = new IntersectionObserver(function (entradas) {
        entradas.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add('visible');
            obs.unobserve(en.target);
          }
        });
      }, { threshold: 0.06, rootMargin: '0px 0px -30px' });

      revelables.forEach(function (el, i) {
        var hermanos = el.parentElement ? [].slice.call(el.parentElement.children).indexOf(el) : i;
        el.style.transitionDelay = Math.min(hermanos, 6) * 0.055 + 's';
        obs.observe(el);
      });
    }
  }

  /* ------------------------------------------- Conteo de cifras del hero */
  var cifras = document.querySelectorAll('[data-contar]');
  if (cifras.length && !reduce && 'IntersectionObserver' in window) {
    var obsC = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (en) {
        if (!en.isIntersecting) return;
        obsC.unobserve(en.target);

        var el      = en.target;
        var destino = parseFloat(el.getAttribute('data-contar'));
        var sufijo  = el.getAttribute('data-sufijo') || '';
        var inicio  = performance.now();
        var dur     = 1000;

        (function paso(ahora) {
          var t = Math.min((ahora - inicio) / dur, 1);
          var e = 1 - Math.pow(1 - t, 3);
          el.textContent = Math.round(destino * e) + sufijo;
          if (t < 1) requestAnimationFrame(paso);
        })(inicio);
      });
    }, { threshold: 0.5 });

    cifras.forEach(function (el) { obsC.observe(el); });
  }

  /* ------------------------------------- Anclas internas: estado activo */
  var anclas = document.querySelectorAll('.anclas a[href^="#"]');
  if (anclas.length && 'IntersectionObserver' in window) {
    var mapa = {};
    anclas.forEach(function (a) {
      var destino = document.getElementById(a.getAttribute('href').slice(1));
      if (destino) mapa[destino.id] = a;
    });

    var obsA = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (en) {
        var a = mapa[en.target.id];
        if (!a) return;
        if (en.isIntersecting) {
          anclas.forEach(function (o) { o.removeAttribute('aria-current'); });
          a.setAttribute('aria-current', 'true');
        }
      });
    }, { rootMargin: '-30% 0px -60% 0px' });

    Object.keys(mapa).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) obsA.observe(el);
    });
  }

  /* --------------------------------- Formulario de cotización → WhatsApp */
  var form = document.getElementById('form-cotizacion');

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;

      var d = new FormData(form);
      var lineas = [
        'Hola FRICON SOLUCIONES, quiero solicitar una cotización.',
        '',
        'Nombre: '   + (d.get('nombre')  || '—'),
        'Entidad: '  + (d.get('entidad') || '—'),
        'Correo: '   + (d.get('correo')  || '—'),
        'Teléfono: ' + (d.get('telefono')|| '—'),
        'Línea: '    + (d.get('linea')   || '—'),
        '',
        'Requerimiento:',
        (d.get('mensaje') || '—')
      ];

      window.open('https://wa.me/' + WA + '?text=' + encodeURIComponent(lineas.join('\n')), '_blank', 'noopener');

      var ok = document.getElementById('form-ok');
      if (ok) { ok.hidden = false; ok.focus(); }
    });
  }

  /* ------------------------- Botón "Cotizar" de cada equipo → WhatsApp */
  document.querySelectorAll('[data-cotizar]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      var equipo = el.getAttribute('data-cotizar');
      var texto  = 'Hola FRICON SOLUCIONES, me interesa cotizar el equipo: ' + equipo + '.';
      window.open('https://wa.me/' + WA + '?text=' + encodeURIComponent(texto), '_blank', 'noopener');
    });
  });

  /* --------------------------------------- Año dinámico en el pie */
  document.querySelectorAll('[data-anio]').forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });
})();
