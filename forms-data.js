// ══════════════════════════════════════════════════════════════
//  ADIATOOL v4 — Modules de relevés
// ══════════════════════════════════════════════════════════════

// Module IDs with scan/equipment capability
const MODULES_WITH_EQUIPMENT = ['primaire','chauffage','ecs','autres_materiels'];

const FORM_MODULES = [

  // ── 1. GÉNÉRALITÉS & MESURES ───────────────────────────────
  {
    id: 'generalites',
    label: 'Généralités & Mesures',
    icon: '🏢',
    color: '#3b82f6',
    fields: [
      { id: 'local_localisation', label: 'Localisation du local', type: 'text', placeholder: 'Ex: Sous-sol niveau -1, bâtiment B' },
      {
        id: 'type_chaufferie', label: 'Type de production',
        type: 'select', options: ['Chauffage seul','Chauffage + ECS','ECS seule'],
        showForTypes: ['Chaufferie','Sous-station principale','Sous-station']
      },
      {
        id: 'type_chaufferie', label: 'Type de production', type: 'select',
        options: ['Chauffage + ECS','Chauffage seul','ECS seule'],
        showForTypes: ['Chaufferie','Sous-station principale','Sous-station']
      },
      { id: 'schema_principe', label: 'Schéma de principe disponible', type: 'yesno' },
      { id: 'etat_local', label: 'État du local', type: 'select', options: ['Propre','Acceptable','Passable','Nettoyage à réaliser','Sale','Très sale'] },
      { id: 'section_dims', label: '— DIMENSIONS LOCAL —', type: 'section' },
      { id: 'local_longueur', label: 'Longueur (m)', type: 'number', step: '0.01' },
      { id: 'local_largeur',  label: 'Largeur (m)',  type: 'number', step: '0.01' },
      { id: 'local_hauteur',  label: 'Hauteur (m)',  type: 'number', step: '0.01' },
      { id: 'local_surface',  label: 'Surface (m²) — calculée', type: 'computed', formula: 'local_longueur * local_largeur', unit: 'm²' },
      { id: 'local_volume',   label: 'Volume (m³) — calculé',   type: 'computed', formula: 'local_longueur * local_largeur * local_hauteur', unit: 'm³' },

      { id: 'section_acces', label: '— ACCÈS —', type: 'section' },
      { id: 'porte_largeur', label: 'Porte — Largeur (cm)', type: 'number' },
      { id: 'porte_hauteur', label: 'Porte — Hauteur (cm)', type: 'number' },
      { id: 'couloir_largeur', label: 'Couloir — Largeur (cm)', type: 'number' },
      { id: 'couloir_hauteur', label: 'Couloir — Hauteur (cm)', type: 'number' },
      { id: '__mesures_libres', label: 'Mesures libres', type: 'mesures_libres' },
      { id: 'notes_generalites', label: 'Observations', type: 'textarea' },
    ]
  },

  // ── 2. CIRCUIT PRIMAIRE ────────────────────────────────────
  {
    id: 'primaire',
    label: 'Circuit primaire',
    icon: '🌡️',
    color: '#f97316',
    hasEquipment: true,
    fields: [
      { id: 'prim_puissance', label: 'Puissance installée', type: 'select',
        options: ['< 70 kW','≥ 70 kW et < 400 kW','≥ 400 kW et < 1 MW','≥ 1 MW'],
        showForTypes: ['Chaufferie','Sous-station principale','Sous-station']
      },
      { id: 'prim_pompes',       label: 'Pompes primaires présentes',       type: 'yesno' },
      { id: 'prim_filtre_tamis', label: 'Filtre à tamis retour général',    type: 'yesno' },
      { id: 'prim_soupape', label: 'Soupape de sécurité', type: 'yesno3' },
      { id: 'prim_nb_soupapes', label: 'Nb soupapes', type: 'number' },
      { id: 'prim_tarage_soupapes', label: 'Tarage soupapes (bar)', type: 'number', step: '0.1' },
      { id: 'prim_vase_exp', label: 'Vase expansion chauffage', type: 'yesno3' },
      { id: 'section_pression',  label: '— PRESSION —', type: 'section' },
      { id: 'prim_pression',     label: 'Pression circuit (bar)',           type: 'number', step: '0.1' },
      // Gaz pressure shown if energie=GAZ
      { id: 'prim_pression_gaz', label: 'Pression GAZ (mbar)',              type: 'number', showIfEnergie: ['GAZ'] },
      // CPCU fields
      { id: 'prim_pression_vapeur_hp',    label: 'Pression vapeur bouteille HP (bar)', type: 'number', step: '0.1', showIfEnergie: ['CPCU'] },
      { id: 'prim_pression_vapeur_apres', label: 'Pression vapeur après vanne détente (bar)', type: 'number', step: '0.1', showIfEnergie: ['CPCU'] },
      { id: 'section_mesures',   label: '— MESURES DE TEMPÉRATURES —', type: 'section' },
      { id: '__mesures_prim',    label: 'Points de mesure', type: 'mesures_temp',
        pointOptions: ['Primaire général','Primaire chauffage','Primaire ECS','Autre'] },
      { id: 'prim_notes', label: 'Observations', type: 'textarea' },
    ]
  },

  // ── 3. CIRCUITS CHAUFFAGE ──────────────────────────────────
  {
    id: 'chauffage',
    label: 'Circuits chauffage',
    icon: '🔥',
    color: '#ef4444',
    hasEquipment: true,
    repeatable: true,
    repeatLabel: 'Circuit chauffage',
    fields: [
      { id: 'chauf_nom', label: 'Nom du circuit', type: 'text', placeholder: 'Ex: Bâtiment A' },
      {
        id: 'chauf_emetteurs', label: "Type d'émetteurs", type: 'select',
        options: ['Radiateurs en fonte','Radiateurs acier','Convecteurs','Plancher chauffant','Ventilo-convecteurs','Aérothermes','Cordon chauffant','Tubes à ailettes','Mixte','Autre']
      },
      { id: 'section_mat_chauf', label: '— MATÉRIELS —', type: 'section' },
      { id: '__equipment_chauf', label: 'Équipements du circuit', type: 'equipment_inline' },
      { id: 'section_mes_chauf', label: '— MESURES —', type: 'section' },
      { id: '__mesures_chauf', label: 'Points de mesure', type: 'mesures_chauf',
        pointOptions: ['Température extérieure régulateur','Température extérieure réelle','Températures réseau','Pression pompe','Débit','Autre'] },
      { id: 'section_reg', label: '— RÉGULATION —', type: 'section' },
      { id: 'reg_mode', label: 'Mode', type: 'select', options: ['Auto','Jour','Nuit','Arrêt','Autre'] },
      { id: 'reg_consigne_confort', label: 'Consigne CONFORT (°C)', type: 'number', step: '0.5' },
      { id: 'reg_consigne_reduit',  label: 'Consigne RÉDUIT (°C)',  type: 'number', step: '0.5' },
      { id: 'reg_hors_gel',         label: 'Hors-gel (°C)',         type: 'number', step: '0.5' },
      { id: 'reg_heure_debut',      label: 'Début confort',         type: 'time' },
      { id: 'reg_heure_fin',        label: 'Fin confort',           type: 'time' },
      { id: 'section_courbe', label: '— COURBE DE CHAUFFE —', type: 'section' },
      { id: '__courbe_chauffe', label: 'Courbe de chauffe', type: 'courbe_chauffe' },
      { id: 'reg_decalage',          label: 'Décalage parallèle', type: 'decalage_stepper' },
      { id: 'reg_eco_jour',          label: 'Mode ECO jour (°C)',  type: 'number', step: '0.5' },
      { id: 'reg_eco_nuit',          label: 'Mode ECO nuit (°C)',  type: 'number', step: '0.5' },
      { id: 'reg_consigne_depart',   label: 'Consigne départ résultante (°C)', type: 'number', step: '0.1' },
      { id: 'section_trait_chauf', label: '— TRAITEMENT EAU CHAUFFAGE —', type: 'section' },
      { id: 'trait_desemboueur', label: 'Desemboueur', type: 'yesno3',
        conditional: { showWhen: { field: 'trait_desemboueur', value: 'oui' }, fields: [
          { id: 'trait_desemboueur_fiche', label: 'Fiche de suivi desemboueur', type: 'yesno3' },
        ]}
      },
      { id: 'trait_adoucisseur_chauf', label: 'Adoucisseur chauffage', type: 'yesno3',
        conditional: { showWhen: { field: 'trait_adoucisseur_chauf', value: 'oui' }, fields: [
          { id: 'trait_sel_chauf', label: 'Stock de sel present', type: 'yesno3' },
        ]}
      },
      { id: 'trait_pot_intro', label: "Pot d'introduction", type: 'yesno3' },
      { id: 'trait_anti_tartre', label: 'Traitement anti-tartre', type: 'yesno3' },
      { id: 'section_mat_dist', label: "— DISTRIBUTION —", type: 'section' },
      { id: 'chauf_type_dist', label: 'Type de distribution', type: 'select', options: ['Bi-tube','Monotube','Plancher chauffant','Mixte','Inconnu','Autre'] },
      { id: 'chauf_materiau', label: 'Matériau distribution', type: 'select',
        options: ['Acier noir','Cuivre','PER','PVC','Multicouche','Fonte','Inconnu','Autre']
      },
      { id: 'chauf_calorifuge_dist', label: 'Distribution calorifugee', type: 'yesno3' },
      { id: 'chauf_vannes_eq', label: 'Vannes equilibrage', type: 'yesno3' },
      { id: 'chauf_robinets_tb', label: 'Robinets thermostatiques', type: 'yesno3' },
      { id: 'chauf_bypass', label: 'Vanne by-pass / BTE', type: 'yesno3' },
      { id: 'chauf_separateur', label: 'Separateur hydraulique', type: 'yesno3' },

      { id: 'chauf_notes', label: 'Observations', type: 'textarea' },
    ]
  },

  // ── 4. CIRCUITS ECS ────────────────────────────────────────
  {
    id: 'ecs',
    label: 'Circuits ECS',
    icon: '💧',
    color: '#06b6d4',
    hasEquipment: true,
    repeatable: true,
    repeatLabel: 'Circuit ECS',
    fields: [
      { id: 'ecs_nom', label: 'Nom du circuit', type: 'text', placeholder: 'ECS générale' },
      {
        id: 'ecs_type_prod', label: 'Type de production', type: 'select',
        options: ['Ballon préparateur','Échangeur instantané','Production semi-instantanée','Ballon + échangeur','Autre']
      },
      { id: 'section_mat_ecs', label: '— MATÉRIELS —', type: 'section' },
      { id: '__equipment_ecs', label: 'Équipements du circuit', type: 'equipment_inline' },
      { id: 'ecs_pompes_boucle', label: 'Pompes de boucle', type: 'text' },
      { id: 'ecs_vanne_3v', label: 'Vanne 3 voies ECS', type: 'text' },
      { id: 'section_mes_ecs', label: '— MESURES —', type: 'section' },
      { id: '__mesures_ecs', label: 'Points de mesure', type: 'mesures_temp', pointOptions: ['Depart ECS','Retour bouclage','Temperature ballon','Autre'] },
      { id: 'ecs_temp_depart',   label: 'Température départ (°C)',  type: 'number', step: '0.1' },
      { id: 'ecs_temp_retour',   label: 'Température retour (°C)',  type: 'number', step: '0.1' },
      { id: 'ecs_temp_stockage', label: 'Température stockage ballon (°C)', type: 'number', step: '0.1', hideIfProd: 'Échangeur instantané' },
      { id: 'section_trait_ecs', label: '— TRAITEMENT EAU ECS —', type: 'section' },
      { id: 'trait_adoucisseur_ecs', label: 'Adoucisseur ECS', type: 'yesno3',
        conditional: { showWhen: { field: 'trait_adoucisseur_ecs', value: 'oui' }, fields: [
          { id: 'trait_sel_ecs', label: 'Stock de sel present', type: 'yesno3' },
        ]}
      },
      { id: 'trait_filmogene', label: 'Traitement filmogene', type: 'yesno3' },
      { id: 'manchette_ef', label: 'Manchette temoin EF', type: 'yesno3' },
      { id: 'manchette_depart', label: 'Manchette temoin depart', type: 'yesno3' },
      { id: 'manchette_boucle', label: 'Manchette temoin boucle', type: 'yesno3' },
      { id: 'section_dist_ecs', label: '— DISTRIBUTION ECS —', type: 'section' },
      {
        id: 'ecs_materiau', label: 'Matériau distribution', type: 'select',
        options: ['Cuivre','PVC-C','Inox','Multicouche','Acier galvanisé','Inconnu','Autre']
      },
      { id: 'ecs_calorifuge_dist', label: 'Distribution calorifugee', type: 'yesno3' },
      { id: 'ecs_mitigeur', label: 'Mitigeur collectif', type: 'yesno3' },
      { id: 'ecs_clapet', label: 'Clapet anti-retour', type: 'yesno3' },
      { id: 'ecs_vase_exp', label: 'Vase expansion ECS', type: 'yesno3' },
      { id: 'ecs_soupape', label: 'Soupape securite ECS', type: 'yesno3' },
      { id: 'ecs_tarage_soupape', label: 'Tarage soupape (bar)', type: 'number', step: '0.1' },

      { id: 'ecs_notes', label: 'Observations', type: 'textarea' },
    ]
  },

  // ── 5. AUTRES MATÉRIELS ────────────────────────────────────
  {
    id: 'autres_materiels',
    label: 'Autres matériels',
    icon: '🔩',
    color: '#6b7280',
    hasEquipment: true,
    fields: [
      { id: '__equipment_autres', label: 'Équipements', type: 'equipment_inline' },
      { id: 'autres_notes', label: 'Observations', type: 'textarea' },
    ]
  },

  // ── 6. CONFORMITÉ ──────────────────────────────────────────
  {
    id: 'conformite',
    label: 'Conformité',
    icon: '✅',
    color: '#22c55e',
    withComments: true,
    sections: [
      {
        title: 'GÉNÉRAL',
        fields: [
          { id: 'conf_vh',             label: 'Ventilation haute (VH)',          type: 'yesno3' },
          { id: 'conf_vb',             label: 'Ventilation basse (VB)',          type: 'yesno3' },
          { id: 'conf_puisard',        label: 'Puisard avec pompe de relevage',  type: 'yesno3' },
          { id: 'conf_caillebotis',    label: 'Caillebotis',                     type: 'yesno3' },
          { id: 'conf_siphon',         label: 'Siphon',                          type: 'yesno3' },
          { id: 'conf_disconnecteur',  label: 'Disconnecteur',                   type: 'yesno3' },
          { id: 'conf_robinet_puisage',label: "Robinet de puisage",              type: 'yesno3' },
          { id: 'conf_tuyau_arrosage', label: "Tuyau d'arrosage",               type: 'yesno3' },
          { id: 'section_ventil', label: '— VENTILATIONS —', type: '__sec' },
          { id: 'conf_vh_present', label: 'Ventilation haute (VH) présente', type: 'yesno3',
            conditional: { showWhen: { field: 'conf_vh_present', value: 'oui' }, fields: [
              { id: 'vh_largeur', label: 'VH — Largeur (cm)', type: 'number' },
              { id: 'vh_hauteur', label: 'VH — Hauteur (cm)', type: 'number' },
            ]}
          },
          { id: 'conf_vb_present', label: 'Ventilation basse (VB) présente', type: 'yesno3',
            conditional: { showWhen: { field: 'conf_vb_present', value: 'oui' }, fields: [
              { id: 'vb_largeur', label: 'VB — Largeur (cm)', type: 'number' },
              { id: 'vb_hauteur', label: 'VB — Hauteur (cm)', type: 'number' },
            ]}
          },
        ]
      },
      {
        title: 'CALORIFUGEAGE',
        fields: [
          { id: 'cal_primaire', label: 'Calorifuge primaire', type: 'yesno3',
            conditional: { showWhen: { field: 'cal_primaire', value: 'oui' }, fields: [
              { id: 'cal_primaire_etat', label: 'État', type: 'select', options: ['Bon état','Dégradé','Partiellement absent'] },
              { id: 'cal_primaire_type', label: 'Type', type: 'select', options: ['Laine de roche','Mousse élastomère','Laine de verre','Polyuréthane','Inconnu','Autre'] },
            ]}
          },
          { id: 'cal_chauffage', label: 'Calorifuge chauffage', type: 'yesno3',
            conditional: { showWhen: { field: 'cal_chauffage', value: 'oui' }, fields: [
              { id: 'cal_chauffage_etat', label: 'État', type: 'select', options: ['Bon état','Dégradé','Partiellement absent'] },
              { id: 'cal_chauffage_type', label: 'Type', type: 'select', options: ['Laine de roche','Mousse élastomère','Laine de verre','Polyuréthane','Inconnu','Autre'] },
            ]}
          },
          { id: 'cal_ecs', label: 'Calorifuge ECS', type: 'yesno3',
            conditional: { showWhen: { field: 'cal_ecs', value: 'oui' }, fields: [
              { id: 'cal_ecs_etat', label: 'État', type: 'select', options: ['Bon état','Dégradé','Partiellement absent'] },
              { id: 'cal_ecs_type', label: 'Type', type: 'select', options: ['Laine de roche','Mousse élastomère','Laine de verre','Polyuréthane','Inconnu','Autre'] },
            ]}
          },
          { id: 'cal_ef', label: 'Calorifuge EF', type: 'yesno3',
            conditional: { showWhen: { field: 'cal_ef', value: 'oui' }, fields: [
              { id: 'cal_ef_etat', label: 'État', type: 'select', options: ['Bon état','Dégradé','Partiellement absent'] },
              { id: 'cal_ef_type', label: 'Type', type: 'select', options: ['Laine de roche','Mousse élastomère','Laine de verre','Polyuréthane','Inconnu','Autre'] },
            ]}
          },
        ]
      },
      {
        title: 'INCENDIE / SÉCURITÉ',
        fields: [
          { id: 'inc_porte_cf',    label: 'Porte coupe-feu',              type: 'yesno3' },
          { id: 'inc_barre_panique',label: 'Barre anti-panique',          type: 'yesno3' },
          { id: 'inc_baes',        label: 'Éclairage de sécurité (BAES)', type: 'yesno3' },
          { id: 'inc_sas',         label: "Présence d'un sas",            type: 'yesno3' },
          { id: 'inc_extincteur',  label: 'Extincteur',                   type: 'yesno3',
            conditional: { showWhen: { field: 'inc_extincteur', value: 'oui' }, fields: [
              { id: 'inc_extincteur_date', label: 'Date dernier contrôle', type: 'date' },
            ]}
          },
          { id: 'inc_plafond_cf',  label: 'Plafond coupe-feu',  type: 'yesno3' },
          { id: 'inc_murs_cf',     label: 'Murs coupe-feu',     type: 'yesno3' },
          { id: 'inc_gaine_pompier',label: 'Gaine pompier',     type: 'yesno3' },
        ]
      },
      {
        title: 'ÉLECTRICITÉ',
        fields: [
          { id: 'elec_armoire',     label: 'Armoire électrique aux normes',   type: 'yesno3' },
          { id: 'elec_voyants',     label: 'Voyants en façade fonctionnels',  type: 'yesno3' },
          { id: 'elec_dtu',         label: 'Boîtier DTU',                     type: 'yesno3' },
          { id: 'elec_eclairage',   label: 'Éclairage suffisant',             type: 'yesno3' },
          { id: 'elec_interrupteur',label: "Interrupteur à l'intérieur",      type: 'yesno3' },
        ]
      },
      {
        title: 'ÉNERGIE / GAZ',
        fields: [
          { id: 'gaz_compteur',           label: 'Compteur GAZ / énergie',         type: 'yesno3' },
          { id: 'gaz_vanne_barrage',      label: 'Vanne de barrage',               type: 'yesno3' },
          { id: 'gaz_electrovanne',       label: 'Électrovanne',                   type: 'yesno3' },
          { id: 'gaz_anti_microcoupures', label: 'Dispositif anti-micro-coupures', type: 'yesno3' },
          { id: 'gaz_detection',          label: 'Détection GAZ',                  type: 'yesno3' },
          { id: 'gaz_filtre',             label: 'Filtre GAZ',                     type: 'yesno3' },
          { id: 'fumee_plaque',           label: 'Plaque signalétique fumisterie', type: 'yesno3' },
        ]
      },

    ],
    notes_field: { id: 'conf_notes', label: 'Observations générales', type: 'textarea' }
  },

  // ── 7. RELEVÉ DE COMPTEURS ─────────────────────────────────
  {
    id: 'compteurs',
    label: 'Relevé de compteurs',
    icon: '📊',
    color: '#8b5cf6',
    repeatable: true,
    repeatLabel: 'Compteur',
    fields: [
      { id: 'cpt_numero',   label: 'N° de compteur', type: 'text' },
      { id: 'cpt_type', label: 'Type', type: 'select',
        options: ['GAZ','Eau froide','Eau chaude sanitaire','Énergie chauffage','Volume appoint chauffage','Électricité','Fioul','CPCU','Réseau de chaleur','Autre'] },
      { id: 'cpt_index',    label: 'Index relevé',   type: 'text' },
      { id: 'cpt_unite',    label: 'Unité', type: 'select', options: ['m³','MWh','kWh','L','Mcal','GJ','kVA'] },
      { id: 'cpt_emplacement', label: 'Emplacement', type: 'text' },
      { id: 'cpt_notes',    label: 'Observations',   type: 'textarea' },
    ]
  },

  // ── 8. CAHIER DE MAINTENANCE ───────────────────────────────
  {
    id: 'cahier',
    label: 'Cahier de maintenance',
    icon: '📓',
    color: '#10b981',
    multiYear: true,
    sections: [
      {
        title: 'SAISON',
        fields: [
          { id: 'cah_cahier_present', label: 'Cahier de maintenance présent', type: 'yesno' },
          { id: 'cah_date_allumage',  label: "Date d'allumage", type: 'date' },
          { id: 'cah_date_arret',     label: "Date d'arrêt",    type: 'date' },
        ]
      },
      {
        title: 'OPÉRATIONS RÉALISÉES',
        fields: [
          { id: 'ram_date',       label: 'Ramonage — date',        type: 'date' },
          { id: 'ram_prestataire',label: 'Ramonage — prestataire', type: 'text' },
          { id: 'ram_rapport',    label: 'Rapport présent',        type: 'yesno' },
          { id: 'comb_date',      label: 'Combustion — date',      type: 'date' },
          { id: 'comb_rendement', label: 'Combustion — rendement (%)', type: 'number', step: '0.1' },
          { id: 'comb_co2',       label: 'Combustion — CO₂ (%)',   type: 'number', step: '0.1' },
          { id: 'comb_co',        label: 'Combustion — CO (ppm)',  type: 'number' },
          { id: 'comb_rapport',   label: 'Rapport combustion présent', type: 'yesno' },
        ]
      },
      {
        title: 'POINTS DIVERS',
        fields: [
          { id: 'cah_point_1_label', label: 'Opération 1 — Libellé', type: 'text' },
          { id: 'cah_point_1_date',  label: 'Opération 1 — Date',    type: 'date' },
          { id: 'cah_point_1_obs',   label: 'Opération 1 — Obs.',    type: 'textarea' },
          { id: 'cah_point_2_label', label: 'Opération 2 — Libellé', type: 'text' },
          { id: 'cah_point_2_date',  label: 'Opération 2 — Date',    type: 'date' },
          { id: 'cah_point_2_obs',   label: 'Opération 2 — Obs.',    type: 'textarea' },
        ]
      }
    ]
  },

];

// ── LOCAL TYPES ────────────────────────────────────────────────
const LOCAL_TYPES = [
  'Chaufferie',
  'Sous-station principale',
  'Sous-station',
  'Local TGBT',
  'Local surpresseur',
  'Autre',
];

// ── OBLIGATIONS ────────────────────────────────────────────────
const OBLIGATIONS_CHAUFFERIE = {
  '< 70 kW': [
    { id: 'ramonage',   label: 'Ramonage',              freq_default: 'Annuel' },
    { id: 'combustion', label: 'Contrôle de combustion', freq_default: 'Annuel' },
    { id: 'entretien',  label: 'Entretien annuel',       freq_default: 'Annuel' },
  ],
  '≥ 70 kW et < 400 kW': [
    { id: 'ramonage',    label: 'Ramonage',               freq_default: 'Semestriel' },
    { id: 'combustion',  label: 'Contrôle de combustion', freq_default: 'Annuel' },
    { id: 'entretien',   label: 'Entretien',              freq_default: 'Annuel' },
    { id: 'analyse_eau', label: 'Analyse eau chauffage',  freq_default: 'Annuel' },
  ],
  '≥ 400 kW et < 1 MW': [
    { id: 'ramonage',       label: 'Ramonage',               freq_default: 'Trimestriel' },
    { id: 'combustion',     label: 'Contrôle de combustion', freq_default: 'Trimestriel' },
    { id: 'entretien',      label: 'Entretien',              freq_default: 'Semestriel' },
    { id: 'analyse_eau',    label: 'Analyse eau chauffage',  freq_default: 'Semestriel' },
    { id: 'disconnecteur',  label: 'Contrôle disconnecteur', freq_default: 'Annuel' },
  ],
  '≥ 1 MW': [
    { id: 'ramonage',       label: 'Ramonage',               freq_default: 'Mensuel' },
    { id: 'combustion',     label: 'Contrôle de combustion', freq_default: 'Trimestriel' },
    { id: 'entretien',      label: 'Entretien',              freq_default: 'Mensuel' },
    { id: 'analyse_eau',    label: 'Analyse eau chauffage',  freq_default: 'Trimestriel' },
    { id: 'disconnecteur',  label: 'Contrôle disconnecteur', freq_default: 'Annuel' },
    { id: 'vase_expansion', label: 'Contrôle vase expansion', freq_default: 'Annuel' },
  ],
};

const FREQ_OPTIONS = ['Mensuel','Trimestriel','Semestriel','Annuel','Non prévu'];
