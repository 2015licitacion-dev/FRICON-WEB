/* ==========================================================================
   FRICON SOLUCIONES S.A.S. — Asistente del catálogo
   Sin dependencias, sin servidor, sin clave de API.

   Cómo funciona
   -------------
   El catálogo completo (js/catalogo.js, generado por catalogo.py) viaja dentro
   de la página. Cuando alguien escribe, el asistente:
     1. normaliza la frase (minúsculas, sin tildes, sin signos),
     2. traduce las palabras de la calle a las del catálogo — "nevera" a
        "refrigerador", "morgue" a "mortuorio", "PAI" a "vacunas",
     3. mira primero si la pregunta es sobre la empresa (precios, garantía,
        dónde quedan) y si no, puntúa cada equipo por coincidencias,
     4. responde con los equipos reales y sus enlaces a la ficha en PDF.

   Nunca inventa un equipo: solo puede nombrar lo que está en el catálogo. Si
   no encuentra nada, lo dice y remite a WhatsApp.

   La pieza que decide la respuesta está aislada en `responder()`. El día que
   haya un servidor con una IA de verdad, se reemplaza esa función por una
   llamada y todo lo demás —panel, historial, tarjetas— sigue igual.
   ========================================================================== */
(function () {
  'use strict';

  var DATOS = window.FRICON_CATALOGO;
  if (!DATOS || !DATOS.equipos || !DATOS.equipos.length) return;

  var WA = '573165274199';
  var MAX = 5;                 // cuántos equipos mostrar por respuesta
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ====================================================== 1. TEXTO */

  /** Minúsculas, sin tildes y sin signos: "Cámaras Mortuorias 2 Cuerpos"
      queda "camaras mortuorias 2 cuerpos". Así "cámara" encuentra "camara". */
  function nrm(s) {
    return (s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Palabras que aparecen en todas las frases y no distinguen nada. Se quitan
     antes de puntuar para que "para" no haga coincidir medio catálogo. */
  var VACIAS = ('de la el los las un una unos unas y o u en del al con para por que se su sus lo a '
    + 'me mi mis te tu ti nos le les es son esta este estos estas eso esa ese si no mas muy tan '
    + 'necesito necesitamos quiero queremos busco buscamos requiero requerimos tienen tiene hay '
    + 'cual cuales como donde cuando cuanto cuanta cuantos cuantas quien quienes porque pero '
    + 'sobre entre desde hasta hola buenas buenos dias tardes noches gracias favor por favor '
    + 'ustedes usted yo nosotros hacer tener poder puede pueden sirve sirven algo alguna algun '
    + 'todo toda todos todas ser estar').split(' ');
  var ESVACIA = {};
  VACIAS.forEach(function (p) { ESVACIA[p] = true; });

  /** Reemplaza las formas coloquiales por la palabra del catálogo.
      Va de frases largas a cortas para que "banco de sangre" se traduzca
      entero antes de que "sangre" lo haga por su cuenta. */
  var PUENTES = (function () {
    var lista = [];
    Object.keys(DATOS.sinonimos || {}).forEach(function (canon) {
      DATOS.sinonimos[canon].forEach(function (voz) {
        lista.push({ de: nrm(voz), a: nrm(canon) });
      });
    });
    lista.sort(function (a, b) { return b.de.length - a.de.length; });
    return lista;
  })();

  function expandir(txt) {
    var t = ' ' + txt + ' ';
    var suma = '';
    PUENTES.forEach(function (p) {
      // El sinónimo NO reemplaza: se suma. Así "nevera de vacunas" busca
      // también "refrigerador" sin perder la palabra que escribió la persona.
      // Se compara con espacios a los lados para no confundir "cava" dentro
      // de "excavadora"; nada de expresiones regulares, que aquí no hacen falta.
      if (t.indexOf(' ' + p.de + ' ') >= 0 && suma.indexOf(' ' + p.a + ' ') < 0) {
        suma += ' ' + p.a + ' ';
      }
    });
    return (t + suma).replace(/\s+/g, ' ').trim();
  }

  function fichas(txt) {
    return expandir(nrm(txt)).split(' ').filter(function (p) {
      return p.length > 1 && !ESVACIA[p];
    });
  }

  /* ====================================================== 2. ÍNDICE */

  /* Se arma una sola vez al cargar. Cada equipo guarda sus campos ya
     normalizados para no repetir el trabajo en cada pregunta. */
  var INDICE = DATOS.equipos.map(function (e) {
    var sec = (DATOS.secciones[e.sec] || {}).nombre || '';
    return {
      e: e,
      cod: nrm(e.cod),
      nombre: nrm(e.nombre),
      cat: nrm(e.cat),
      sec: nrm(sec),
      desc: nrm(e.desc),
      secNombre: sec
    };
  });

  var TEMAS = (DATOS.empresa || []).map(function (t) {
    return { t: t, claves: t.clave.map(nrm) };
  });

  /* ====================================================== 3. BÚSQUEDA */

  /** Puntúa un equipo contra las palabras de la pregunta.
      El nombre pesa más que la descripción porque es lo que la gente escribe. */
  function puntuar(it, pals, crudo) {
    var p = 0, tocados = 0;

    // Código exacto: "NS-VAC250" o "vac250" tiene que ganarle a todo.
    if (crudo.indexOf(it.cod) >= 0 || it.cod.replace(/\s/g, '') === crudo.replace(/\s/g, '')) {
      p += 60; tocados++;
    }

    pals.forEach(function (w) {
      // Los números tienen que coincidir enteros. Buscándolos como trozo de
      // texto, "-80 grados" encontraba el congelador de "800 L", que no tiene
      // nada que ver: el 80 estaba dentro del 800.
      var numero = /^\d+$/.test(w);
      var hay = numero
        ? function (campo) { return (' ' + campo + ' ').indexOf(' ' + w + ' ') >= 0; }
        : function (campo) { return campo.indexOf(w) >= 0; };

      var toco = false;
      if (hay(it.cod))     { p += 14; toco = true; }
      if (hay(it.nombre))  { p += 10; toco = true; }
      if (hay(it.cat))     { p += 5;  toco = true; }
      if (hay(it.desc))    { p += 2;  toco = true; }
      if (hay(it.sec))     { p += 1.5; toco = true; }
      if (toco) tocados++;
      // Un número que sí coincide entero es muy informativo: "400 litros",
      // "2 cuerpos", "3 puertas".
      if (numero && hay(it.nombre)) p += 6;
    });

    // Premia que coincidan varias palabras y no una sola repetida.
    if (pals.length > 1) p *= (1 + (tocados / pals.length) * 0.6);
    return tocados ? p : 0;
  }

  function buscar(txt) {
    var crudo = nrm(txt);
    var pals = fichas(txt);
    if (!pals.length) return [];

    var res = [];
    INDICE.forEach(function (it) {
      var p = puntuar(it, pals, crudo);
      if (p > 0) res.push({ it: it, p: p });
    });
    res.sort(function (a, b) { return b.p - a.p; });
    if (!res.length) return [];

    // Corta la cola de resultados flojos: si el mejor saca 60 puntos, no tiene
    // sentido mostrar uno de 4 que solo coincide en una palabra suelta.
    // Con los de otra línea se es más estricto: quien pregunta por una mesa de
    // autopsia no quiere ver una prensa de cacao solo porque ambas dicen
    // "extracción".
    var techo = res[0].p;
    var linea = res[0].it.e.sec;
    res = res.filter(function (r) {
      var minimo = r.it.e.sec === linea ? techo * 0.42 : techo * 0.68;
      return r.p >= Math.max(minimo, 6);
    });
    return res.slice(0, MAX).map(function (r) { return r.it.e; });
  }

  function tema(txt) {
    var q = ' ' + nrm(txt) + ' ';
    var mejor = null, mejorP = 0;
    TEMAS.forEach(function (t) {
      var p = 0;
      t.claves.forEach(function (k) {
        if (q.indexOf(' ' + k + ' ') >= 0 || q.indexOf(k) >= 0) p += k.split(' ').length * 2 + 1;
      });
      if (p > mejorP) { mejorP = p; mejor = t.t; }
    });
    return mejorP >= 3 ? mejor : null;
  }

  /* ====================================================== 4. RESPUESTA */

  var SALUDOS = /^\s*(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|holi|que tal|saludos|buen dia)\b/i;
  var GRACIAS = /\b(gracias|muchas gracias|mil gracias|vale|listo|perfecto|ok)\b/i;
  var GENERAL = /\b(que (venden|tienen|manejan|ofrecen|hacen)|catalogo|catalogos|productos|equipos|lineas|que puedes|que sabes|ayuda|ayudame|opciones)\b/i;

  function resumenLineas() {
    var cuenta = {};
    DATOS.equipos.forEach(function (e) { cuenta[e.sec] = (cuenta[e.sec] || 0) + 1; });
    return Object.keys(DATOS.secciones).map(function (k) {
      return { txt: DATOS.secciones[k].nombre + ' (' + (cuenta[k] || 0) + ')', href: DATOS.secciones[k].portada };
    });
  }

  /**
   * El cerebro. Recibe la frase y devuelve qué contestar.
   * Aquí y solo aquí se decide: si mañana entra una IA real, se cambia esto.
   */
  function responder(txt) {
    var limpio = txt.trim();

    if (GRACIAS.test(limpio) && limpio.length < 26) {
      return { texto: 'Con gusto. Si necesita la cotización formal o quiere hablar con un asesor, escríbanos por WhatsApp y le respondemos de una vez.',
               acciones: [{ txt: 'Escribir por WhatsApp', href: 'https://wa.me/' + WA }] };
    }

    if (SALUDOS.test(limpio) && limpio.length < 30) {
      return { texto: 'Hola. Soy el asistente de FRICON. Puedo buscarle un equipo entre las '
                    + DATOS.equipos.length + ' fichas técnicas del catálogo, o responderle sobre la empresa, '
                    + 'la garantía y cómo cotizar. Dígame qué necesita.',
               chips: ['Nevera para vacunas', 'Cámara mortuoria', 'Cuarto frío', '¿Cómo cotizo?'] };
    }

    // Primero la empresa: si alguien pregunta el precio, no queremos que le
    // salga una lista de equipos que no responde nada.
    var t = tema(limpio);
    var eq = buscar(limpio);

    if (t && (!eq.length || GENERAL.test(limpio) === false && eq.length < 2)) {
      return { texto: t.r, acciones: (t.ir || []).map(function (a) { return { txt: a[0], href: a[1] }; }) };
    }

    if (eq.length) {
      var cab = eq.length === 1
        ? 'Encontré este equipo:'
        : 'Encontré ' + eq.length + ' equipos que le pueden servir:';
      var r = { texto: cab, equipos: eq };
      if (t) {
        r.acciones = (t.ir || []).map(function (a) { return { txt: a[0], href: a[1] }; });
      }
      return r;
    }

    if (t) {
      return { texto: t.r, acciones: (t.ir || []).map(function (a) { return { txt: a[0], href: a[1] }; }) };
    }

    if (GENERAL.test(limpio)) {
      return { texto: 'Tenemos ' + DATOS.equipos.length + ' equipos con ficha técnica, repartidos en tres líneas. '
                    + 'Escoja una o dígame directamente qué necesita —por ejemplo «nevera para vacunas» o «mesa de autopsia».',
               acciones: resumenLineas() };
    }

    return { texto: 'No encontré ningún equipo con eso en el catálogo. Puede intentar con otras palabras '
                  + '—por ejemplo «congelador», «cuarto frío», «mesa de autopsia» o «tostador»— o escribirnos '
                  + 'directamente y un asesor le responde.',
             acciones: [{ txt: 'Escribir por WhatsApp', href: 'https://wa.me/' + WA },
                        { txt: 'Solicitar cotización', href: 'contacto.html' }],
             chips: ['Nevera para vacunas', 'Cámara mortuoria', 'Máquina de hielo', 'Tostador de cacao'] };
  }

  /* ====================================================== 5. PANEL */

  /* Recorte cuadrado de «CEREBRO FRICON.jpg» (carpeta assets), preparado para
     web: 512 px y 40 KB en vez de los 2 MB del original, y encuadrado para que
     el logo entre completo dentro del círculo del botón flotante. */
  var CEREBRO = 'assets/cerebro-fricon.jpg';

  var raiz = document.createElement('div');
  raiz.className = 'ia-raiz';
  raiz.innerHTML = ''
    + '<button class="ia-boton" type="button" aria-haspopup="dialog" aria-label="Abrir el asistente del catálogo">'
    +   '<img src="' + CEREBRO + '" alt="" width="80" height="80">'
    +   '<span class="ia-boton-pulso" aria-hidden="true"></span>'
    + '</button>'
    + '<span class="ia-globo" aria-hidden="true">Soy FRICON… ¡Pregúntame!</span>'
    + '<dialog class="ia-panel" closedby="any" aria-labelledby="ia-titulo">'
    +   '<div class="ia-cab">'
    +     '<img class="ia-cab-icono" src="' + CEREBRO + '" alt="" width="40" height="40">'
    +     '<div>'
    +       '<h2 id="ia-titulo">Asistente FRICON</h2>'
    +       '<p>Busca entre ' + DATOS.equipos.length + ' fichas técnicas</p>'
    +     '</div>'
    +     '<button class="ia-cerrar" type="button" aria-label="Cerrar el asistente">'
    +       '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'
    +     '</button>'
    +   '</div>'
    +   '<div class="ia-hilo" role="log" aria-live="polite" aria-relevant="additions" tabindex="0"></div>'
    +   '<form class="ia-pie" autocomplete="off">'
    +     '<label class="oculto-visual" for="ia-entrada">Escriba su pregunta</label>'
    +     '<input id="ia-entrada" type="text" placeholder="Ej.: nevera para vacunas del PAI" maxlength="160">'
    +     '<button type="submit" aria-label="Enviar">'
    +       '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15M13 6l6 6-6 6"/></svg>'
    +     '</button>'
    +   '</form>'
    +   '<p class="ia-nota">Busca dentro del catálogo publicado. Para precios y disponibilidad, escríbanos.</p>'
    + '</dialog>';
  document.body.appendChild(raiz);

  var boton  = raiz.querySelector('.ia-boton');
  var globo  = raiz.querySelector('.ia-globo');
  var panel  = raiz.querySelector('.ia-panel');
  var hilo   = raiz.querySelector('.ia-hilo');
  var form   = raiz.querySelector('.ia-pie');
  var campo  = raiz.querySelector('#ia-entrada');

  /* -------------------------------------------- anclado al hero / flotante
     Si la página trae una franja de aterrizaje (#ia-anclaje, hoy solo la
     principal), el botón y su globo empiezan dentro de ella, a la vista, y
     bajan a la esquina en cuanto esa franja sale de pantalla. Se mueven los
     nodos de sitio en vez de duplicarlos: así hay un solo botón, con sus
     eventos y su estado intactos. El panel de conversación no se mueve
     —vive en el <body> porque es un diálogo modal—. */

  var anclaje = document.getElementById('ia-anclaje');
  var anclado = false;

  function anclar() {
    if (anclado || !anclaje) return;
    anclado = true;
    boton.removeAttribute('data-recien-soltado');
    anclaje.appendChild(globo);
    anclaje.appendChild(boton);
  }

  function soltar() {
    if (!anclado) return;
    anclado = false;
    raiz.insertBefore(globo, panel);
    raiz.insertBefore(boton, globo);
    // El gesto de llegada solo cuando ya hubo interacción de scroll real.
    boton.setAttribute('data-recien-soltado', 'true');
    setTimeout(function () { boton.removeAttribute('data-recien-soltado'); }, 400);
  }

  if (anclaje) {
    anclar();
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entradas) {
        entradas.forEach(function (e) { e.isIntersecting ? anclar() : soltar(); });
      }, { rootMargin: '-10px 0px 0px 0px' }).observe(anclaje);
    } else {
      // Navegador antiguo: al primer scroll se suelta y se queda flotando.
      window.addEventListener('scroll', function suelta() {
        if (window.scrollY > 220) { soltar(); window.removeEventListener('scroll', suelta); }
      }, { passive: true });
    }
  }

  /* ---------------------------------------------------- pintar mensajes */

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Los PDF tienen espacios y tildes en el nombre; hay que codificarlos
      pero conservando las barras de las carpetas. */
  function ruta(p) { return encodeURI(p); }

  function burbuja(clase, html) {
    var d = document.createElement('div');
    d.className = 'ia-msg ' + clase;
    d.innerHTML = html;
    hilo.appendChild(d);
    hilo.scrollTop = hilo.scrollHeight;
    return d;
  }

  function tarjetaEquipo(e) {
    var sec = (DATOS.secciones[e.sec] || {}).nombre || '';
    var cot = 'https://wa.me/' + WA + '?text='
            + encodeURIComponent('Hola FRICON SOLUCIONES, me interesa cotizar el equipo: ' + e.nombre + ' (' + e.cod + ').');
    return ''
      + '<article class="ia-eq">'
      +   '<div class="ia-eq-enc"><b>' + esc(e.cod) + '</b><span>' + esc(sec) + ' · ' + esc(e.cat) + '</span></div>'
      +   '<h3>' + esc(e.nombre) + '</h3>'
      +   (e.desc ? '<p>' + esc(e.desc.length > 165 ? e.desc.slice(0, 162) + '…' : e.desc) + '</p>' : '')
      +   '<div class="ia-eq-pie">'
      +     '<a href="' + esc(ruta(e.pdf)) + '" target="_blank" rel="noopener">Ver ficha</a>'
      +     '<a href="' + esc(e.pag) + '">Ver categoría</a>'
      +     '<a href="' + esc(cot) + '" target="_blank" rel="noopener">Cotizar</a>'
      +   '</div>'
      + '</article>';
  }

  function pintarRespuesta(r) {
    var html = '<p>' + esc(r.texto) + '</p>';

    if (r.equipos && r.equipos.length) {
      html += '<div class="ia-eqs">' + r.equipos.map(tarjetaEquipo).join('') + '</div>';
    }
    if (r.acciones && r.acciones.length) {
      html += '<div class="ia-acciones">' + r.acciones.map(function (a) {
        var fuera = /^https?:/.test(a.href) ? ' target="_blank" rel="noopener"' : '';
        return '<a class="ia-accion" href="' + esc(a.href) + '"' + fuera + '>' + esc(a.txt) + '</a>';
      }).join('') + '</div>';
    }
    if (r.chips && r.chips.length) {
      html += '<div class="ia-chips">' + r.chips.map(function (c) {
        return '<button type="button" class="ia-chip">' + esc(c) + '</button>';
      }).join('') + '</div>';
    }
    burbuja('-bot', html);
  }

  /* ---------------------------------------------------- conversación */

  var pensando = null;

  function preguntar(txt) {
    txt = (txt || '').trim();
    if (!txt) return;

    burbuja('-yo', '<p>' + esc(txt) + '</p>');
    campo.value = '';

    // Una pausa corta antes de responder: sin ella la respuesta aparece de
    // golpe junto a la pregunta y no se entiende que son dos turnos.
    pensando = burbuja('-bot -pensando', '<span></span><span></span><span></span>');
    var espera = reduce ? 0 : 380;

    setTimeout(function () {
      if (pensando) { pensando.remove(); pensando = null; }
      pintarRespuesta(responder(txt));
    }, espera);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    preguntar(campo.value);
  });

  hilo.addEventListener('click', function (e) {
    var chip = e.target.closest('.ia-chip');
    if (chip) preguntar(chip.textContent);
  });

  /* ---------------------------------------------------- abrir y cerrar */

  var estrenado = false;

  /* «usado» = la persona ya abrió el asistente en esta visita. A partir de ahí
     el globo se calla: insistir después de que ya lo probó, molesta. */
  var usado = false;
  try { usado = !!sessionStorage.getItem('ia-usado'); } catch (e) { /* sin sessionStorage */ }

  function abrir() {
    callarGlobo();
    if (!estrenado) {
      estrenado = true;
      pintarRespuesta({
        texto: 'Hola. Soy el asistente de FRICON. Dígame qué equipo necesita —con sus palabras, '
             + 'como se lo pediría a un asesor— y le busco la ficha técnica entre las '
             + DATOS.equipos.length + ' del catálogo.',
        chips: ['Nevera para vacunas', 'Cámara mortuoria de 3 cuerpos', 'Cuarto frío',
                'Máquina de hielo', 'Tostador de cacao', '¿Cómo cotizo?']
      });
    }
    panel.showModal();
    setTimeout(function () { campo.focus(); }, 60);
  }

  boton.addEventListener('click', abrir);
  raiz.querySelector('.ia-cerrar').addEventListener('click', function () { panel.close(); });
  panel.addEventListener('close', function () { boton.focus(); });

  // Cierre al tocar fuera para los navegadores que aún no entienden `closedby`
  // (Safari, a día de hoy). Con soporte nativo esto no se registra.
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    panel.addEventListener('click', function (ev) {
      if (ev.target !== panel) return;
      var c = panel.getBoundingClientRect();
      var dentro = ev.clientY >= c.top && ev.clientY <= c.bottom
                && ev.clientX >= c.left && ev.clientX <= c.right;
      if (!dentro) panel.close();
    });
  }

  /* ------------------------------------------- el globo de invitación
     Asoma cada cierto tiempo mientras la persona no haya usado el asistente:
     4 s de espera, 6 s a la vista, 20 s de descanso, y otra vez. Deja de
     insistir en cuanto abre el panel —ya sabe que el botón está ahí— y se
     queda quieto si la pestaña no está a la vista, para no gastar la
     aparición hablándole a nadie. */
  var ESPERA_1 = 4000,   // antes de la primera aparición
      A_LA_VISTA = 6000, // cuánto se queda cada vez
      DESCANSO = 20000;  // pausa entre una aparición y la siguiente

  var globoTimer = null;

  function mostrarGlobo() {
    if (usado) return;
    // Si el panel está abierto o la pestaña en segundo plano, se salta el turno
    // pero el ciclo continúa: no se pierde para siempre.
    if (panel.open || document.visibilityState !== 'visible') { programarGlobo(DESCANSO); return; }
    globo.setAttribute('data-visible', 'true');
    globoTimer = setTimeout(function () {
      globo.setAttribute('data-visible', 'false');
      programarGlobo(DESCANSO);
    }, A_LA_VISTA);
  }

  function programarGlobo(ms) {
    clearTimeout(globoTimer);
    if (usado) return;
    globoTimer = setTimeout(mostrarGlobo, ms);
  }

  function callarGlobo() {
    usado = true;
    clearTimeout(globoTimer);
    globo.setAttribute('data-visible', 'false');
    try { sessionStorage.setItem('ia-usado', '1'); } catch (e) { /* da igual */ }
  }

  if (!usado) programarGlobo(ESPERA_1);

  // Si la persona vuelve a la pestaña, el ciclo sigue desde el descanso.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !usado && !panel.open) programarGlobo(DESCANSO);
  });
})();
