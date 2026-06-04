// ══════════════════════════════════════════════════════════════
//  ADIATOOL — Définition des modules de relevés
//  Chaque module peut être activé/désactivé par mission
// ══════════════════════════════════════════════════════════════

const FORM_MODULES = [

  // ── 1. GÉNÉRALITÉS BÂTIMENT ────────────────────────────────
  {
    id: 'generalites',
    label: 'Généralités bâtiment',
    icon: '🏢',
    color: '#3b82f6',
    fields: [
      { id: 'type_construction', label: 'Type de construction', type: 'select', options: ['Classique','Haussmannien','Récent (< 1975)','Récent (> 1975)','BBC','RT2012','Industriel','Autre'] },
      { id: 'nb_batiments',  label: 'Nombre de bâtiments',  type: 'number' },
      { id: 'nb_niveaux',    label: 'Nombre de niveaux',    type: 'number' },
      { id: 'nb_logements',  label: 'Nombre de logements',  type: 'number' },
      { id: 'nb_locaux_pro', label: 'Dont locaux professionnels', type: 'number' },
      { id: 'hauteur_statique', label: 'Hauteur statique (m)', type: 'number' },
      { id: 'emplacement_chauf', label: 'Emplacement chaufferie', type: 'text', placeholder: 'Ex: Sous-sol niveau -1' },
      { id: 'annee_construction', label: 'Année de construction', type: 'number' },
      { id: 'energie_principale', label: 'Énergie principale', type: 'select', options: ['Gaz naturel','Fioul','CPCU / Réseau chaleur','Pompe à chaleur','Électrique','Autre'] },
      { id: 'puissance_chaudiere', label: 'Puissance installée', type: 'select', options: ['< 70 kW','≥ 70 kW et < 400 kW','≥ 400 kW et < 1 MW','≥ 1 MW'] },
      { id: 'schema_principe', label: 'Schéma de principe disponible', type: 'yesno' },
      { id: 'cahier_chauf', label: 'Cahier de chaufferie présent', type: 'yesno' },
      { id: 'notes_generalites', label: 'Observations', type: 'textarea' },
    ]
  },

  // ── 2. CONFORMITÉ LOCAL TECHNIQUE ──────────────────────────
  {
    id: 'conformite',
    label: 'Conformité local technique',
    icon: '✅',
    color: '#22c55e',
    sections: [
      {
        title: 'GÉNÉRAL',
        fields: [
          { id: 'conf_vh', label: 'Ventilation haute (VH)', type: 'yesno' },
          { id: 'conf_vb', label: 'Ventilation basse (VB)', type: 'yesno' },
          { id: 'conf_puisard', label: 'Puisard avec pompe de relevage', type: 'yesno' },
          { id: 'conf_caillebotis', label: 'Caillebotis', type: 'yesno' },
          { id: 'conf_siphon', label: 'Siphon', type: 'yesno' },
          { id: 'conf_disconnecteur', label: 'Disconnecteur', type: 'yesno' },
          { id: 'conf_robinet_puisage', label: 'Robinet de puisage', type: 'yesno' },
          { id: 'conf_tuyau_arrosage', label: 'Tuyau d\'arrosage', type: 'yesno' },
        ]
      },
      {
        title: 'CALORIFUGEAGE',
        fields: [
          { id: 'cal_primaire', label: 'Calorifuge primaire', type: 'yesno' },
          { id: 'cal_chauffage', label: 'Calorifuge chauffage', type: 'yesno' },
          { id: 'cal_ecs', label: 'Calorifuge ECS', type: 'yesno' },
          { id: 'cal_ef', label: 'Calorifuge EF', type: 'yesno' },
        ]
      },
      {
        title: 'INCENDIE / SÉCURITÉ',
        fields: [
          { id: 'inc_porte_cf', label: 'Porte coupe-feu', type: 'yesno' },
          { id: 'inc_barre_panique', label: 'Barre anti-panique', type: 'yesno' },
          { id: 'inc_baes', label: 'Éclairage de sécurité (BAES)', type: 'yesno' },
          { id: 'inc_sas', label: 'Présence d\'un sas', type: 'yesno' },
          { id: 'inc_extincteur', label: 'Extincteur', type: 'yesno' },
          { id: 'inc_plafond_cf', label: 'Plafond coupe-feu', type: 'yesno' },
          { id: 'inc_murs_cf', label: 'Murs coupe-feu', type: 'yesno' },
          { id: 'inc_gaine_pompier', label: 'Gaine pompier', type: 'yesno' },
        ]
      },
      {
        title: 'ÉLECTRICITÉ',
        fields: [
          { id: 'elec_armoire', label: 'Armoire électrique aux normes', type: 'yesno' },
          { id: 'elec_voyants', label: 'Voyants en façade fonctionnels', type: 'yesno' },
          { id: 'elec_dtu', label: 'Boîtier DTU', type: 'yesno' },
          { id: 'elec_eclairage', label: 'Éclairage suffisant', type: 'yesno' },
          { id: 'elec_interrupteur', label: 'Interrupteur à l\'intérieur', type: 'yesno' },
        ]
      },
      {
        title: 'ÉNERGIE / GAZ',
        fields: [
          { id: 'gaz_compteur', label: 'Compteur GAZ / énergie', type: 'yesno' },
          { id: 'gaz_vanne_barrage', label: 'Vanne de barrage', type: 'yesno' },
          { id: 'gaz_electrovanne', label: 'Électrovanne', type: 'yesno' },
          { id: 'gaz_anti_microcoupures', label: 'Dispositif anti-micro-coupures', type: 'yesno' },
          { id: 'gaz_detection', label: 'Détection GAZ', type: 'yesno' },
          { id: 'gaz_filtre', label: 'Filtre GAZ', type: 'yesno' },
          { id: 'gaz_pression', label: 'Pression GAZ (mbar)', type: 'number' },
          { id: 'fumee_hauteur', label: 'Hauteur évacuation fumées (m)', type: 'number' },
          { id: 'fumee_plaque', label: 'Plaque signalétique fumisterie', type: 'yesno' },
        ]
      },
      {
        title: 'TRAITEMENT EAU — CHAUFFAGE',
        fields: [
          { id: 'trait_desemboueur', label: 'Présence désemboueur', type: 'yesno' },
          { id: 'trait_adoucisseur_chauf', label: 'Présence adoucisseur chauffage', type: 'yesno' },
          { id: 'trait_pot_intro', label: 'Pot d\'introduction', type: 'yesno' },
          { id: 'trait_anti_tartre', label: 'Traitement anti-tartre', type: 'yesno' },
        ]
      },
      {
        title: 'TRAITEMENT EAU — ECS',
        fields: [
          { id: 'trait_adoucisseur_ecs', label: 'Adoucisseur ECS', type: 'yesno' },
          { id: 'trait_filmogene', label: 'Traitement filmogène', type: 'yesno' },
          { id: 'manchette_ef', label: 'Manchette témoin EF', type: 'yesno' },
          { id: 'manchette_depart', label: 'Manchette témoin départ', type: 'yesno' },
          { id: 'manchette_boucle', label: 'Manchette témoin boucle', type: 'yesno' },
        ]
      },
    ],
    notes_field: { id: 'conf_notes', label: 'Observations conformité', type: 'textarea' }
  },

  // ── 3. RELEVÉ DE TEMPÉRATURES — PRIMAIRE ──────────────────
  {
    id: 'primaire',
    label: 'Circuit primaire',
    icon: '🌡️',
    color: '#f97316',
    fields: [
      { id: 'prim_pression', label: 'Pression circuit (bar)', type: 'number', step: '0.1' },
      { id: 'prim_temp_depart', label: 'Température départ (°C)', type: 'number', step: '0.1' },
      { id: 'prim_temp_retour', label: 'Température retour (°C)', type: 'number', step: '0.1' },
      { id: 'prim_compteur', label: 'Index compteur', type: 'text' },
      { id: 'prim_notes', label: 'Observations', type: 'textarea' },
    ]
  },

  // ── 4. CIRCUITS CHAUFFAGE (répétable) ─────────────────────
  {
    id: 'chauffage',
    label: 'Circuits chauffage',
    icon: '🔥',
    color: '#ef4444',
    repeatable: true,
    repeatLabel: 'Circuit chauffage',
    fields: [
      { id: 'chauf_nom', label: 'Nom du circuit', type: 'text', placeholder: 'Ex: Bâtiment A' },
      { id: 'chauf_emetteurs', label: 'Type d\'émetteurs', type: 'select', options: ['Radiateurs','Plancher chauffant','Ventilo-convecteurs','Aérothermes','Mixte','Autre'] },
      { id: 'chauf_pompes', label: 'Pompes chauffage', type: 'text', placeholder: 'Marque, modèle' },
      { id: 'chauf_pression_amont', label: 'Pression amont (bar)', type: 'number', step: '0.1' },
      { id: 'chauf_pression_aval', label: 'Pression aval (bar)', type: 'number', step: '0.1' },
      { id: 'chauf_vanne_3v', label: 'Vanne 3 voies', type: 'text' },
      { id: 'chauf_temp_depart', label: 'Température départ (°C)', type: 'number', step: '0.1' },
      { id: 'chauf_temp_retour', label: 'Température retour (°C)', type: 'number', step: '0.1' },
      { id: 'chauf_compteur_eau', label: 'Compteur appoints (m³)', type: 'text' },
      { id: 'chauf_compteur_energie', label: 'Compteur énergie (MWh)', type: 'text' },
      { id: 'section_regulation', label: '— RÉGULATION —', type: 'section' },
      { id: 'reg_regime', label: 'Régime', type: 'text' },
      { id: 'reg_consigne_confort', label: 'Consigne CONFORT (°C)', type: 'number', step: '0.5' },
      { id: 'reg_consigne_reduit', label: 'Consigne RÉDUIT (°C)', type: 'number', step: '0.5' },
      { id: 'reg_antigel', label: 'Consigne anti-gel (°C)', type: 'number', step: '0.5' },
      { id: 'reg_heure_debut', label: 'Heure début confort', type: 'time' },
      { id: 'reg_heure_fin', label: 'Heure fin confort', type: 'time' },
      { id: 'reg_courbe_15', label: 'Courbe chauffe Text=15°C', type: 'number', step: '0.5' },
      { id: 'reg_courbe_m5', label: 'Courbe chauffe Text=-5°C', type: 'number', step: '0.5' },
      { id: 'reg_decalage', label: 'Décalage parallèle', type: 'number', step: '0.5' },
      { id: 'reg_temp_ext', label: 'Température extérieure relevée (°C)', type: 'number', step: '0.1' },
      { id: 'reg_consigne_depart', label: 'Consigne de départ résultante (°C)', type: 'number', step: '0.1' },
      { id: 'chauf_notes', label: 'Observations', type: 'textarea' },
    ]
  },

  // ── 5. CIRCUITS ECS (répétable) ────────────────────────────
  {
    id: 'ecs',
    label: 'Circuits ECS',
    icon: '💧',
    color: '#06b6d4',
    repeatable: true,
    repeatLabel: 'Circuit ECS',
    fields: [
      { id: 'ecs_nom', label: 'Nom du circuit', type: 'text', placeholder: 'Ex: ECS générale' },
      { id: 'ecs_type_prod', label: 'Type de production', type: 'select', options: ['Ballon préparateur','Échangeur instantané','Production semi-instantanée','Ballon + échangeur','Autre'] },
      { id: 'ecs_pompes_boucle', label: 'Pompes de boucle', type: 'text' },
      { id: 'ecs_vanne_3v', label: 'Vanne 3 voies', type: 'text' },
      { id: 'ecs_temp_depart', label: 'Température départ (°C)', type: 'number', step: '0.1' },
      { id: 'ecs_temp_retour', label: 'Température retour (°C)', type: 'number', step: '0.1' },
      { id: 'ecs_compteur_eau', label: 'Compteur ECS (m³)', type: 'text' },
      { id: 'ecs_compteur_energie', label: 'Compteur énergie (MWh)', type: 'text' },
      { id: 'ecs_temp_stockage', label: 'Température stockage ballon (°C)', type: 'number', step: '0.1' },
      { id: 'ecs_notes', label: 'Observations', type: 'textarea' },
    ]
  },

  // ── 6. COMPTEURS ──────────────────────────────────────────
  {
    id: 'compteurs',
    label: 'Relevé de compteurs',
    icon: '📊',
    color: '#8b5cf6',
    repeatable: true,
    repeatLabel: 'Compteur',
    fields: [
      { id: 'cpt_numero', label: 'N° de compteur', type: 'text', placeholder: 'Ex: 12345678' },
      { id: 'cpt_type', label: 'Type', type: 'select', options: ['Gaz','Eau froide','Eau chaude sanitaire','Énergie chauffage','Énergie ECS','Électricité','Fioul','CPCU','Autre'] },
      { id: 'cpt_index', label: 'Index relevé', type: 'text', placeholder: 'Valeur + unité' },
      { id: 'cpt_unite', label: 'Unité', type: 'select', options: ['m³','MWh','kWh','L','Mcal','GJ','kVA'] },
      { id: 'cpt_emplacement', label: 'Emplacement', type: 'text' },
      { id: 'cpt_notes', label: 'Observations', type: 'textarea' },
    ]
  },

  // ── 7. MESURES DU LOCAL ────────────────────────────────────
  {
    id: 'mesures',
    label: 'Mesures & dimensions',
    icon: '📐',
    color: '#eab308',
    sections: [
      {
        title: 'DIMENSIONS LOCAL CHAUFFERIE',
        fields: [
          { id: 'local_longueur', label: 'Longueur (m)', type: 'number', step: '0.01' },
          { id: 'local_largeur',  label: 'Largeur (m)',  type: 'number', step: '0.01' },
          { id: 'local_hauteur',  label: 'Hauteur (m)',  type: 'number', step: '0.01' },
          { id: 'local_surface',  label: 'Surface (m²) — calculée', type: 'computed', formula: 'local_longueur * local_largeur', unit: 'm²' },
          { id: 'local_volume',   label: 'Volume (m³) — calculé',   type: 'computed', formula: 'local_longueur * local_largeur * local_hauteur', unit: 'm³' },
        ]
      },
      {
        title: 'VENTILATIONS',
        fields: [
          { id: 'vh_largeur', label: 'VH — Largeur (cm)', type: 'number' },
          { id: 'vh_hauteur', label: 'VH — Hauteur (cm)', type: 'number' },
          { id: 'vh_section', label: 'VH — Section (cm²) — calculée', type: 'computed', formula: 'vh_largeur * vh_hauteur', unit: 'cm²' },
          { id: 'vb_largeur', label: 'VB — Largeur (cm)', type: 'number' },
          { id: 'vb_hauteur', label: 'VB — Hauteur (cm)', type: 'number' },
          { id: 'vb_section', label: 'VB — Section (cm²) — calculée', type: 'computed', formula: 'vb_largeur * vb_hauteur', unit: 'cm²' },
        ]
      },
      {
        title: 'PORTE & ACCÈS',
        fields: [
          { id: 'porte_largeur', label: 'Porte — Largeur (cm)', type: 'number' },
          { id: 'porte_hauteur', label: 'Porte — Hauteur (cm)', type: 'number' },
          { id: 'couloir_largeur', label: 'Couloir cave — Largeur (cm)', type: 'number' },
          { id: 'couloir_hauteur', label: 'Couloir cave — Hauteur (cm)', type: 'number' },
        ]
      },
      {
        title: 'AUTRES MESURES',
        fields: [
          { id: 'mesure_libre_1_label', label: 'Mesure libre 1 — Libellé', type: 'text', placeholder: 'Ex: Diamètre cheminée' },
          { id: 'mesure_libre_1_val',   label: 'Mesure libre 1 — Valeur', type: 'text' },
          { id: 'mesure_libre_2_label', label: 'Mesure libre 2 — Libellé', type: 'text' },
          { id: 'mesure_libre_2_val',   label: 'Mesure libre 2 — Valeur', type: 'text' },
          { id: 'mesure_libre_3_label', label: 'Mesure libre 3 — Libellé', type: 'text' },
          { id: 'mesure_libre_3_val',   label: 'Mesure libre 3 — Valeur', type: 'text' },
        ]
      }
    ],
    notes_field: { id: 'mesures_notes', label: 'Observations', type: 'textarea' }
  },

  // ── 8. CAHIER DE CHAUFFERIE ────────────────────────────────
  {
    id: 'cahier',
    label: 'Cahier de chaufferie',
    icon: '📓',
    color: '#10b981',
    sections: [
      {
        title: 'SAISON EN COURS',
        fields: [
          { id: 'cah_date_allumage',  label: 'Date d\'allumage',     type: 'date' },
          { id: 'cah_date_arret',     label: 'Date d\'arrêt saison', type: 'date' },
          { id: 'cah_nb_jours_chauf', label: 'Nombre de jours de chauffe', type: 'number' },
        ]
      },
      {
        title: 'RAMONAGE',
        fields: [
          { id: 'ram_date_dernier',   label: 'Date du dernier ramonage', type: 'date' },
          { id: 'ram_prestataire',    label: 'Prestataire', type: 'text' },
          { id: 'ram_rapport_ok',     label: 'Rapport de ramonage présent', type: 'yesno' },
          { id: 'ram_prochain',       label: 'Prochain ramonage prévu', type: 'date' },
        ]
      },
      {
        title: 'CONTRÔLE DE COMBUSTION',
        fields: [
          { id: 'comb_date',          label: 'Date du dernier contrôle', type: 'date' },
          { id: 'comb_rendement',     label: 'Rendement (%)', type: 'number', step: '0.1' },
          { id: 'comb_co2',           label: 'Taux CO₂ (%)', type: 'number', step: '0.1' },
          { id: 'comb_co',            label: 'Taux CO (ppm)', type: 'number' },
          { id: 'comb_rapport_ok',    label: 'Rapport de combustion présent', type: 'yesno' },
        ]
      },
      {
        title: 'ENTRETIEN CONTRACTUEL',
        fields: [
          { id: 'entr_ramonage_contrat',   label: 'Ramonage au contrat', type: 'yesno' },
          { id: 'entr_ramonage_freq',      label: 'Fréquence ramonage', type: 'select', options: ['Mensuel','Trimestriel','Semestriel','Annuel','Non prévu'] },
          { id: 'entr_combustion_contrat', label: 'Combustion au contrat', type: 'yesno' },
          { id: 'entr_combustion_freq',    label: 'Fréquence combustion', type: 'select', options: ['Mensuel','Trimestriel','Semestriel','Annuel','Non prévu'] },
          { id: 'entr_disconnecteur',      label: 'Contrôle disconnecteur', type: 'yesno' },
          { id: 'entr_vase_exp',           label: 'Contrôle vase d\'expansion', type: 'yesno' },
          { id: 'entr_detartrage',         label: 'Détartrage appareils production', type: 'yesno' },
          { id: 'entr_desinfection_ecs',   label: 'Désinfection ballon ECS', type: 'yesno' },
          { id: 'entr_analyses_chauf',     label: 'Analyses eau chauffage', type: 'yesno' },
          { id: 'entr_analyses_ecs',       label: 'Analyses eau ECS', type: 'yesno' },
          { id: 'entr_desemboueur',        label: 'Nettoyage désemboueur', type: 'yesno' },
          { id: 'entr_fiche_suivi',        label: 'Fiche suivi traitement eau', type: 'yesno' },
        ]
      },
      {
        title: 'POINTS DIVERS',
        fields: [
          { id: 'cah_point_libre_1', label: 'Point divers 1 — Libellé', type: 'text', placeholder: 'Ex: Remplacement circulateur' },
          { id: 'cah_point_libre_1_date', label: 'Point divers 1 — Date', type: 'date' },
          { id: 'cah_point_libre_1_obs',  label: 'Point divers 1 — Obs.', type: 'textarea' },
          { id: 'cah_point_libre_2', label: 'Point divers 2 — Libellé', type: 'text' },
          { id: 'cah_point_libre_2_date', label: 'Point divers 2 — Date', type: 'date' },
          { id: 'cah_point_libre_2_obs',  label: 'Point divers 2 — Obs.', type: 'textarea' },
        ]
      }
    ],
    notes_field: { id: 'cahier_notes', label: 'Observations générales cahier', type: 'textarea' }
  },

];
