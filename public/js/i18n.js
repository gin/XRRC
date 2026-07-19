(function exposeI18n(root, factory) {
  'use strict';

  const i18n = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = i18n;
  } else {
    root.XRRCI18n = i18n;
  }
})(typeof window === 'undefined' ? globalThis : window, function createI18n(root) {
  'use strict';

  const dictionaries = {
    en: {
      'meta.skip': 'Skip to race setup',
      'meta.canvas': 'Interactive XRRC race track',
      'hero.tagline': 'Build a tiny track.\nMake a huge mess.',
      'hero.note': 'A pocket-sized dirt rally for WebXR, phone, and desktop. Bring your own pit crew.',
      'hero.lab': 'Lab test no. 04',
      'hero.scale': '1:10 scale',
      'hero.spec': 'Backyard spec',
      'setup.pitBoard': 'Pit board',
      'setup.title': 'Set your heat',
      'setup.room': 'Room code',
      'setup.roomHelp': 'Use the same code to race with friends.',
      'setup.vehicle': 'Vehicle bay',
      'setup.track': 'Track kit',
      'setup.relay': 'Multiplayer relay',
      'setup.signal': 'Tailscale Serve URL',
      'setup.signalHelp': 'Private rooms work when each player can reach this tailnet device.',
      'setup.solo': 'Leave blank for a solo heat.',
      'setup.language': 'Language',
      'setup.test': 'Test',
      'setup.testing': 'Testing',
      'track.jump': 'Launch ramp',
      'track.jumpNote': 'Catch air',
      'track.loop': 'Stunt loop',
      'track.loopNote': 'Go vertical',
      'track.street': 'Street kit',
      'track.streetNote': 'Cones + lights',
      'mode.webxr': 'Start WebXR',
      'mode.webxrNote': 'AR / best ride',
      'mode.webxrUnavailable': 'WebXR unavailable',
      'mode.webxrFallback': 'Try desktop or camera',
      'mode.desktop': 'Desktop race',
      'mode.desktopNote': 'Keyboard + controller',
      'mode.camera': 'Use camera mode instead',
      'status.ready': 'WebXR is ready. Choose a track and race.',
      'status.fallback': 'Desktop and camera modes are ready.',
      'status.loadingCamera': 'Loading camera mode...',
      'status.cameraError': 'Could not start camera mode: {message}',
      'status.webxrError': 'Could not start WebXR: {message}',
      'status.sessionEnded': 'AR session ended. Ready for another heat.',
      'race.place': 'Scan a flat surface, then tap to drop the track',
      'race.go': 'GO',
      'race.reset': 'Vehicle reset to the grid',
      'race.copied': 'Room link copied',
      'race.shareFailed': 'Could not share this room',
      'race.joined': 'A new racer joined',
      'race.solo': 'Solo heat',
      'race.cars': 'cars',
      'race.invite': 'Invite',
      'race.resetAction': 'Reset',
      'race.drag': 'Drag to drive',
      'race.driveKeys': 'or arrows to drive',
      'race.resetKey': 'to reset',
      'race.roomTitle': 'XRRC room #{room}',
      'race.roomInvite': 'Join my XRRC backyard rally.',
      'controller.keyboard': 'Keyboard ready',
      'controller.connected': '{label} connected',
      'controller.disconnected': '{label} disconnected',
      'network.connecting': 'Joining private relay',
      'network.ready': 'Relay connected',
      'signal.solo': 'Leave blank for a solo heat.',
      'signal.calling': 'Calling the Tailscale relay...',
      'signal.ready': 'Relay ready - {count} active connections.',
      'signal.timeout': 'Relay timed out. Check Tailscale and try again.',
      'signal.offline': '{message}. Join the tailnet and verify Serve is running.',
      'common.solo': 'Solo',
      'common.ready': 'Ready',
      'common.offline': 'Offline',
      'common.on': 'On',
      'common.off': 'Off',
      'audio.preferences': 'Audio preferences',
      'audio.music': 'Music',
      'audio.unavailable': 'Web Audio is unavailable in this browser',
      'vehicle.rally': 'Rally car',
      'vehicle.buggy': 'Dune buggy',
      'vehicle.truck': '4x4 truck',
      'vehicle.motorcycle': 'RC motorcycle',
      'vehicle.tank': 'Mini tank',
      'vehicle.plane': 'Prop plane',
      'vehicle.helicopter': 'Helicopter',
      'vehicle.toy-car-1': 'Racer 1',
      'vehicle.toy-car-2': 'Racer 2',
      'vehicle.toy-car-3': 'Racer 3',
      'vehicle.toy-car-taxi': 'Taxi',
      'vehicle.toy-car-cop': 'Police',
      'vehicle.car1': 'Coupe',
    },
    es: {
      'meta.skip': 'Saltar a la configuracion',
      'meta.canvas': 'Pista de carreras XRRC interactiva',
      'hero.tagline': 'Construye una pista pequena.\nHaz un desastre enorme.',
      'hero.note': 'Un rally de bolsillo para WebXR, telefono y escritorio. Trae a tu equipo.',
      'hero.lab': 'Prueba de laboratorio 04',
      'hero.scale': 'Escala 1:10',
      'hero.spec': 'Edicion patio',
      'setup.pitBoard': 'Panel de boxes',
      'setup.title': 'Prepara la carrera',
      'setup.room': 'Codigo de sala',
      'setup.roomHelp': 'Usa el mismo codigo para competir con amigos.',
      'setup.vehicle': 'Garaje',
      'setup.track': 'Kit de pista',
      'setup.relay': 'Rele multijugador',
      'setup.signal': 'URL de Tailscale Serve',
      'setup.signalHelp': 'Las salas privadas funcionan si todos acceden al dispositivo de la tailnet.',
      'setup.solo': 'Dejalo vacio para correr en solitario.',
      'setup.language': 'Idioma',
      'setup.test': 'Probar',
      'setup.testing': 'Probando',
      'track.jump': 'Rampa',
      'track.jumpNote': 'Salta',
      'track.loop': 'Rizo',
      'track.loopNote': 'Sube en vertical',
      'track.street': 'Kit urbano',
      'track.streetNote': 'Conos y luces',
      'mode.webxr': 'Iniciar WebXR',
      'mode.webxrNote': 'RA / mejor opcion',
      'mode.webxrUnavailable': 'WebXR no disponible',
      'mode.webxrFallback': 'Usa escritorio o camara',
      'mode.desktop': 'Carrera de escritorio',
      'mode.desktopNote': 'Teclado y mando',
      'mode.camera': 'Usar modo camara',
      'status.ready': 'WebXR esta listo. Elige una pista y corre.',
      'status.fallback': 'Los modos de escritorio y camara estan listos.',
      'status.loadingCamera': 'Cargando modo camara...',
      'status.cameraError': 'No se pudo iniciar el modo camara: {message}',
      'status.webxrError': 'No se pudo iniciar WebXR: {message}',
      'status.sessionEnded': 'La sesion RA termino. Lista para otra carrera.',
      'race.place': 'Escanea una superficie plana y toca para colocar la pista',
      'race.go': 'YA',
      'race.reset': 'Vehiculo devuelto a la parrilla',
      'race.copied': 'Enlace de sala copiado',
      'race.shareFailed': 'No se pudo compartir la sala',
      'race.joined': 'Se unio otro piloto',
      'race.solo': 'Carrera individual',
      'race.cars': 'coches',
      'race.invite': 'Invitar',
      'race.resetAction': 'Reiniciar',
      'race.drag': 'Arrastra para conducir',
      'race.driveKeys': 'o flechas para conducir',
      'race.resetKey': 'para reiniciar',
      'race.roomTitle': 'Sala XRRC #{room}',
      'race.roomInvite': 'Unete a mi rally XRRC.',
      'controller.keyboard': 'Teclado listo',
      'controller.connected': '{label} conectado',
      'controller.disconnected': '{label} desconectado',
      'network.connecting': 'Entrando al rele privado',
      'network.ready': 'Rele conectado',
      'signal.solo': 'Dejalo vacio para correr en solitario.',
      'signal.calling': 'Contactando el rele Tailscale...',
      'signal.ready': 'Rele listo - {count} conexiones activas.',
      'signal.timeout': 'El rele no respondio. Comprueba Tailscale.',
      'signal.offline': '{message}. Unete a la tailnet y comprueba Serve.',
      'common.solo': 'Solo',
      'common.ready': 'Listo',
      'common.offline': 'Sin conexion',
      'common.on': 'Si',
      'common.off': 'No',
      'audio.preferences': 'Preferencias de audio',
      'audio.music': 'Musica',
      'audio.unavailable': 'Web Audio no esta disponible en este navegador',
      'vehicle.rally': 'Coche de rally',
      'vehicle.buggy': 'Buggy',
      'vehicle.truck': 'Camion 4x4',
      'vehicle.motorcycle': 'Moto RC',
      'vehicle.tank': 'Mini tanque',
      'vehicle.plane': 'Avion',
      'vehicle.helicopter': 'Helicoptero',
    },
    fr: {
      'meta.skip': 'Aller aux reglages de course',
      'meta.canvas': 'Circuit XRRC interactif',
      'hero.tagline': 'Construisez une petite piste.\nFaites un enorme nuage.',
      'hero.note': 'Un rallye de poche pour WebXR, mobile et ordinateur. Invitez votre equipe.',
      'hero.lab': 'Essai laboratoire 04',
      'hero.scale': 'Echelle 1:10',
      'hero.spec': 'Version jardin',
      'setup.pitBoard': 'Panneau des stands',
      'setup.title': 'Preparez la course',
      'setup.room': 'Code du salon',
      'setup.roomHelp': 'Utilisez le meme code pour courir avec vos amis.',
      'setup.vehicle': 'Garage',
      'setup.track': 'Kit de piste',
      'setup.relay': 'Relais multijoueur',
      'setup.signal': 'URL Tailscale Serve',
      'setup.signalHelp': 'Les salons prives fonctionnent si chaque joueur rejoint le tailnet.',
      'setup.solo': 'Laissez vide pour une course solo.',
      'setup.language': 'Langue',
      'setup.test': 'Tester',
      'setup.testing': 'Test en cours',
      'track.jump': 'Tremplin',
      'track.jumpNote': 'Decollez',
      'track.loop': 'Looping',
      'track.loopNote': 'Passez a la verticale',
      'track.street': 'Kit urbain',
      'track.streetNote': 'Cones et feux',
      'mode.webxr': 'Demarrer WebXR',
      'mode.webxrNote': 'RA / recommande',
      'mode.webxrUnavailable': 'WebXR indisponible',
      'mode.webxrFallback': 'Essayez ordinateur ou camera',
      'mode.desktop': 'Course sur ordinateur',
      'mode.desktopNote': 'Clavier et manette',
      'mode.camera': 'Utiliser le mode camera',
      'status.ready': 'WebXR est pret. Choisissez une piste et roulez.',
      'status.fallback': 'Les modes ordinateur et camera sont prets.',
      'status.loadingCamera': 'Chargement du mode camera...',
      'status.cameraError': 'Impossible de lancer le mode camera : {message}',
      'status.webxrError': 'Impossible de lancer WebXR : {message}',
      'status.sessionEnded': 'Session RA terminee. Pret pour une autre course.',
      'race.place': 'Scannez une surface plane puis touchez pour poser la piste',
      'race.go': 'GO',
      'race.reset': 'Vehicule replace sur la grille',
      'race.copied': 'Lien du salon copie',
      'race.shareFailed': 'Impossible de partager le salon',
      'race.joined': 'Un nouveau pilote est arrive',
      'race.solo': 'Course solo',
      'race.cars': 'vehicules',
      'race.invite': 'Inviter',
      'race.resetAction': 'Replacer',
      'race.drag': 'Glissez pour conduire',
      'race.driveKeys': 'ou fleches pour conduire',
      'race.resetKey': 'pour replacer',
      'race.roomTitle': 'Salon XRRC #{room}',
      'race.roomInvite': 'Rejoignez mon rallye XRRC.',
      'controller.keyboard': 'Clavier pret',
      'controller.connected': '{label} connectee',
      'controller.disconnected': '{label} deconnectee',
      'network.connecting': 'Connexion au relais prive',
      'network.ready': 'Relais connecte',
      'signal.solo': 'Laissez vide pour une course solo.',
      'signal.calling': 'Connexion au relais Tailscale...',
      'signal.ready': 'Relais pret - {count} connexions actives.',
      'signal.timeout': 'Le relais ne repond pas. Verifiez Tailscale.',
      'signal.offline': '{message}. Rejoignez le tailnet et verifiez Serve.',
      'common.solo': 'Solo',
      'common.ready': 'Pret',
      'common.offline': 'Hors ligne',
      'common.on': 'Oui',
      'common.off': 'Non',
      'audio.preferences': 'Preferences audio',
      'audio.music': 'Musique',
      'audio.unavailable': 'Web Audio est indisponible dans ce navigateur',
      'vehicle.rally': 'Voiture de rallye',
      'vehicle.buggy': 'Buggy',
      'vehicle.truck': 'Camion 4x4',
      'vehicle.motorcycle': 'Moto RC',
      'vehicle.tank': 'Mini char',
      'vehicle.plane': 'Avion',
      'vehicle.helicopter': 'Helicoptere',
    },
  };
  const supported = Object.keys(dictionaries);
  let language = 'en';

  function normalizeLanguage(value) {
    const normalized = String(value || '').toLowerCase().split('-')[0];
    return supported.includes(normalized) ? normalized : 'en';
  }

  function resolveLanguage(search = '', navigatorLanguages = [], storedLanguage = null) {
    const queryLanguage = new URLSearchParams(search).get('lang');
    const candidates = [queryLanguage, storedLanguage, ...navigatorLanguages].filter(Boolean);
    const match = candidates.find((candidate) => (
      supported.includes(String(candidate).toLowerCase().split('-')[0])
    ));
    return normalizeLanguage(match);
  }

  function setLanguage(nextLanguage, persist = true) {
    language = normalizeLanguage(nextLanguage);
    if (persist && root.localStorage) {
      try {
        root.localStorage.setItem('xrrc-language', language);
      } catch {
        // Language still applies when storage is unavailable.
      }
    }
    return language;
  }

  function getStoredLanguage() {
    try {
      return root.localStorage ? root.localStorage.getItem('xrrc-language') : null;
    } catch {
      return null;
    }
  }

  function t(key, values = {}) {
    const template = dictionaries[language][key] || dictionaries.en[key] || key;
    return template.replace(/\{(\w+)\}/g, (_match, name) => values[name] ?? '');
  }

  function applyDocument(documentLike) {
    documentLike.documentElement.lang = language;
    documentLike.querySelectorAll('[data-i18n]').forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    documentLike.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
      element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
    });
    const bindings = {
      '.tagline': 'hero.tagline',
      '.hero-note': 'hero.note',
      '#setup-title': 'setup.title',
      'label[for="room-input"]': 'setup.room',
      '#room-help': 'setup.roomHelp',
      '.vehicle-field legend': 'setup.vehicle',
      '.kit-field legend': 'setup.track',
      '#signal-panel .relay-label': 'setup.relay',
      'label[for="signal-input"]': 'setup.signal',
      '#signal-help': 'setup.signalHelp',
      '#place-hint': 'race.place',
      '#desktop-btn span': 'mode.desktop',
      '#desktop-btn small': 'mode.desktopNote',
      '#eighthwall-btn': 'mode.camera',
    };
    for (const [selector, key] of Object.entries(bindings)) {
      const element = documentLike.querySelector(selector);
      if (element) element.textContent = t(key);
    }
    const trackBindings = {
      'prop-jump': ['track.jump', 'track.jumpNote'],
      'prop-loop': ['track.loop', 'track.loopNote'],
      'prop-traffic': ['track.street', 'track.streetNote'],
    };
    for (const [id, keys] of Object.entries(trackBindings)) {
      const label = documentLike.getElementById(id).closest('label');
      label.querySelector('strong').textContent = t(keys[0]);
      label.querySelector('small').textContent = t(keys[1]);
    }
    documentLike.querySelectorAll('input[name="vehicle"]').forEach((input) => {
      input.closest('label').querySelector('strong').textContent = t(`vehicle.${input.value}`);
    });
    const languageSelect = documentLike.getElementById('language-select');
    if (languageSelect) languageSelect.value = language;
  }

  return Object.freeze({
    applyDocument,
    dictionaries,
    get language() {
      return language;
    },
    getStoredLanguage,
    normalizeLanguage,
    resolveLanguage,
    setLanguage,
    supported,
    t,
  });
});
