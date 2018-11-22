class Model {
  constructor(id=null, name=null, fields=null, templates=null, css='') {
  }
}

class Deck {
}

class Note {
}

class Card {
}

const schema = `
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

/* there's only one |col| row in the db. */
CREATE TABLE col (
    id              integer primary key,
    crt             integer not null, /* creation time (seconds since epoch) */
    mod             integer not null, /* modification time (millis since epoch) */
    scm             integer not null, /* schema modified (millis since epoch) */
    ver             integer not null, /* Anki schema version, 11 at time of writing */
    dty             integer not null, /* no longer used */
    usn             integer not null, /* not sure, looks like it has something to do with sync? 0 in new deck. */
    ls              integer not null, /* last sync (millis since epoch) */
    conf            text not null, /* json, see defaultConf */
    models          text not null, /* json, in form { [modelId]: Model }. see defaultModel. */
    decks           text not null,
    dconf           text not null, /* { [deckId]: DeckConf } */
    tags            text not null  /* { [tagName]: usn } */
);

CREATE TABLE notes (
    id              integer primary key,   /* 0 */
    guid            text not null,         /* 1 */
    mid             integer not null,      /* 2 */
    mod             integer not null,      /* 3 */
    usn             integer not null,      /* 4 */
    tags            text not null,         /* 5 */
    flds            text not null,         /* 6 */
    sfld            integer not null,      /* 7 */
    csum            integer not null,      /* 8 */
    flags           integer not null,      /* 9 */
    data            text not null          /* 10 */
);
CREATE TABLE cards (
    id              integer primary key,   /* 0 */
    nid             integer not null,      /* 1 */
    did             integer not null,      /* 2 */
    ord             integer not null,      /* 3 */
    mod             integer not null,      /* 4 */
    usn             integer not null,      /* 5 */
    type            integer not null,      /* 6 */
    queue           integer not null,      /* 7 */
    due             integer not null,      /* 8 */
    ivl             integer not null,      /* 9 */
    factor          integer not null,      /* 10 */
    reps            integer not null,      /* 11 */
    lapses          integer not null,      /* 12 */
    left            integer not null,      /* 13 */
    odue            integer not null,      /* 14 */
    odid            integer not null,      /* 15 */
    flags           integer not null,      /* 16 */
    data            text not null          /* 17 */
);
CREATE TABLE revlog (
    id              integer primary key,
    cid             integer not null,
    usn             integer not null,
    ease            integer not null,
    ivl             integer not null,
    lastIvl         integer not null,
    factor          integer not null,
    time            integer not null,
    type            integer not null
);
CREATE TABLE graves (
    usn             integer not null,
    oid             integer not null,
    type            integer not null
);
ANALYZE sqlite_master;
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
COMMIT;
`

const MODEL_STD = 0
const MODEL_CLOZE = 1

const defaultModel = {
  sortf: 0,
  did: 1,
  latexPre: `\\documentclass[12pt]{article}
\\special{papersize=3in,5in}
\\usepackage[utf8]{inputenc}
\\usepackage{amssymb,amsmath}
\\pagestyle{empty}
\\setlength{\\parindent}{0in}
\\begin{document}`,
  latexPost: "\\end{document}",
  mod: 0,
  usn: 0,
  vers: [],
  type: MODEL_STD,
  css: `.card {
 font-family: arial;
 font-size: 20px;
 text-align: center;
 color: black;
 background-color: white;
}`
  /* also:
  name: string,
  flds: [Field],
  tmpls: [Template],
  tags: [??],
  id: string
  */
}

// whether new cards should be mixed with reviews, or shown first or last
const NEW_CARDS_DISTRIBUTE = 0
const NEW_CARDS_LAST = 1
const NEW_CARDS_FIRST = 2

const defaultConf = {
  // review options
  'activeDecks': [1],
  'curDeck': 1,
  'newSpread': NEW_CARDS_DISTRIBUTE,
  'collapseTime': 1200,
  'timeLim': 0,
  'estTimes': true,
  'dueCounts': true,
  // other config
  'curModel': null,
  'nextPos': 1,
  'sortType': "noteFld",
  'sortBackwards': false,
  'addToCur': true, // add new to currently selected deck?
  'dayLearnFirst': false,
}


// new card insertion order
const NEW_CARDS_RANDOM = 0
const NEW_CARDS_DUE = 1

const STARTING_FACTOR = 2500

const defaultDeckConf = {
  'name': "Default",
  'new': {
    'delays': [1, 10],
    'ints': [1, 4, 7], // 7 is not currently used
    'initialFactor': STARTING_FACTOR,
    'separate': true,
    'order': NEW_CARDS_DUE,
    'perDay': 20,
    // may not be set on old decks
    'bury': false,
  },
  'lapse': {
    'delays': [10],
    'mult': 0,
    'minInt': 1,
    'leechFails': 8,
    // type 0=suspend, 1=tagonly
    'leechAction': 0,
  },
  'rev': {
    'perDay': 200,
    'ease4': 1.3,
    'fuzz': 0.05,
    'minSpace': 1, // not currently used
    'ivlFct': 1,
    'maxIvl': 36500,
    // may not be set on old decks
    'bury': false,
    'hardFactor': 1.2,
  },
  'maxTaken': 60,
  'timer': 0,
  'autoplay': true,
  'replayq': true,
  'mod': 0,
  'usn': 0,
}

const defaultField = {
  name: "",
  ord: null,
  sticky: false,
  rtl: false,
  font: "Arial",
  size: 20,
  media: [],
}

const defaultTemplate = {
  name: "",
  ord: null,
  qfmt: "",
  afmt: "",
  did: null,
  bqfmt: "",
  bafmt: "",
}

class Package {
  write(db) {
    const now = new Date
    db.serialize(() => {
      db.run(schema);
      db.run(`INSERT INTO col
      (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
      VALUES ($id, $crt, $mod, $scm, $ver, $dty, $usn, $ls, $conf, $models, $decks, $dconf, $tags)`, {
        $id: null,
        $crt: (+now/1000)|0,
        $mod: +now,
        $scm: +now,
        $ver: 11,
        $dty: 0,
        $usn: 0,
        $ls: 0,
        $conf: JSON.stringify(defaultConf),
        $models: JSON.stringify(this.models),
        $decks: JSON.stringify(this.decks),
        $dconf: JSON.stringify({}), // TODO
        $tags: JSON.stringify({}),
      })
    })
  }
}
