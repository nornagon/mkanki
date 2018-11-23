const crypto = require('crypto')
const tmp = require('tmp')
const sqlite = require('sqlite3')
const fs = require('fs')
const archiver = require('archiver')

class Model {
  constructor(props) {
    this.props = props
  }

  note(fields) {
    return new Note(this, fields)
  }
}

  /*
new Model({
  name: "Basic",
  id: "1542906796044",
  tags: [],
  type: 0,
  "did": 1,
  flds: [
    {
      size: 20,
      name: "Front",
      media: [],
      rtl: false,
      ord: 0,
      font: "Arial",
      sticky: false
    },
    {
      size: 20,
      name: "Back",
      media: [],
      rtl: false,
      ord: 1,
      font: "Arial",
      sticky: false
    }
  ],
  "req": [
    [
      0,
      "all",
      [ 0 ]
    ]
  ],
  "sortf": 0,
  "tmpls": [
    {
      "afmt": "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}",
      "name": "Card 1",
      "qfmt": "{{Front}}",
      "did": null,
      "ord": 0,
      "bafmt": "",
      "bqfmt": ""
    }
  ],
  "css": ".card {\n font-family: arial;\n font-size: 20px;\n text-align: center;\n color: black;\n background-color: white;\n}\n",

  "latexPre": "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
  "latexPost": "\\end{document}",
  "mod": 1542906796,
  "vers": [],
  "usn": -1,
})

new Model({
  name: "Cloze",
  id: "1542906796040",
  type: 1,
  tags: [],
  "did": 1,
  flds: [
    {
      size: 20,
      name: "Text",
      media: [],
      rtl: false,
      ord: 0,
      font: "Arial",
      sticky: false
    },
    {
      size: 20,
      name: "Extra",
      media: [],
      rtl: false,
      ord: 1,
      font: "Arial",
      sticky: false
    }
  ],
  sortf: 0,
  tmpls: [
    {
      "afmt": "{{cloze:Text}}<br>\n{{Extra}}",
      "name": "Cloze",
      "qfmt": "{{cloze:Text}}",
      "did": null,
      "ord": 0,
      "bafmt": "",
      "bqfmt": ""
    }
  ],
  "css": ".card {\n font-family: arial;\n font-size: 20px;\n text-align: center;\n color: black;\n background-color: white;\n}\n\n.cloze {\n font-weight: bold;\n color: blue;\n}",

  "latexPre": "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
  "latexPost": "\\end{document}",
  "mod": 1542906796
  "vers": [],
  "usn": -1,
})
*/

class Deck {
  constructor(id, name) {
    this.id = id
    this.name = name
    this.notes = []
  }

  addNote(note) {
    this.notes.push(note)
  }

  toJSON() {
    return {
      name: this.name,
      "extendRev": 50,
      "usn": -1,
      "collapsed": false,
      "newToday": [0, 0],
      "timeToday": [0, 0],
      "dyn": 0,
      "extendNew": 10,
      "conf": 1,
      "revToday": [0, 0],
      "lrnToday": [0, 0],
      "id": this.id,
      "mod": (+new Date/1000)|0,
      "desc": ""
    }
  }
}


BASE91_TABLE = [
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's',
  't', 'u', 'v', 'w', 'x', 'y', 'z', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L',
  'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '0', '1', '2', '3', '4',
  '5', '6', '7', '8', '9', '!', '#', '$', '%', '&', '(', ')', '*', '+', ',', '-', '.', '/', ':',
  ';', '<', '=', '>', '?', '@', '[', ']', '^', '_', '`', '{', '|', '}', '~']

function ankiHash(fields) {
  const str = fields.join('__')
  const h = crypto.createHash('sha256')
  h.update(str)
  const hex = h.digest()

  let hash_int = 0n
  for (let i = 0; i < 8; i++) {
    hash_int *= 256n
    hash_int += BigInt(hex[i])
  }

  // convert to the weird base91 format that Anki uses
  let rv_reversed = []
  while (hash_int > 0) {
    rv_reversed.push(BASE91_TABLE[hash_int % 91n])
    hash_int = (hash_int / 91n)
  }

  return rv_reversed.reverse().join('')
}

class Note {
  constructor(model, fields) {
    this.model = model
    this.fields = fields
  }

  get guid() {
    return ankiHash(this.fields)
  }

  get cards() {
    const isEmpty = f => {
      return !f || f.toString().trim().length === 0
    }
    const rv = []
    for (const [card_ord, any_or_all, required_field_ords] of this.model.props.req) {
      const op = any_or_all === "any" ? "some" : "every"
      if (required_field_ords[op](f => !isEmpty(this.fields[f]))) {
        rv.push(card_ord)
      }
    }
    return rv
  }
}

class Card {
  constructor(ord) {
    this.ord = ord
  }
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
    mid             integer not null,      /* 2 */  /* model id */
    mod             integer not null,      /* 3 */  /* modification time, (seconds since epoch) */
    usn             integer not null,      /* 4 */
    tags            text not null,         /* 5 */  /* space-separated string */
    flds            text not null,         /* 6 */  /* \\x1f-separated field strings */
    sfld            integer not null,      /* 7 */  /* unsure, something to do with sorting? */
    csum            integer not null,      /* 8 */  /* checksum, can be ignored according to genanki */
    flags           integer not null,      /* 9 */  /* unsure, can be 0 though */
    data            text not null          /* 10 */  /* unsure, genanki forces it to '' */
);
CREATE TABLE cards (
    id              integer primary key,   /* 0 */
    nid             integer not null,      /* 1 */  /* note id */
    did             integer not null,      /* 2 */  /* deck id */
    ord             integer not null,      /* 3 */  /* order */
    mod             integer not null,      /* 4 */  /* modification time (seconds since epoch) */
    usn             integer not null,      /* 5 */
    type            integer not null,      /* 6 */  /* MODEL_STD | MODEL_CLOZE */
    queue           integer not null,      /* 7 */  /* -1 if self.suspend else 0 */
    due             integer not null,      /* 8 */  /* 0 */
    ivl             integer not null,      /* 9 */  /* 0 */
    factor          integer not null,      /* 10 */  /* 0 */
    reps            integer not null,      /* 11 */  /* 0 */
    lapses          integer not null,      /* 12 */  /* 0 */
    left            integer not null,      /* 13 */  /* 0 */
    odue            integer not null,      /* 14 */  /* 0 */
    odid            integer not null,      /* 15 */  /* 0 */
    flags           integer not null,      /* 16 */  /* 0 */
    data            text not null          /* 17 */  /* "" */
);

/* following 2 tables aren't used by genanki; are they needed? */
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
  constructor() {
    this.decks = []
  }

  addDeck(deck) {
    this.decks.push(deck)
  }

  writeToFile(filename) {
    const {name, fd} = tmp.fileSync()
    const db = require('better-sqlite3')(name)
    this.write(db)
    db.close()
    const out = fs.createWriteStream(filename)
    const archive = archiver('zip')
    archive.pipe(out)
    archive.file(name, { name: 'collection.anki2' })
    archive.append('{}', { name: 'media' })
    archive.finalize()
  }

  write(db) {
    const now = new Date
    const models = {}
    const decks = {}
    this.decks.forEach(d => {
      d.notes.forEach(n => models[n.model.props.id] = n.model.props)
      decks[d.id] = d
    })

    const col = {
      id: null,
      crt: (+now/1000)|0,
      mod: +now,
      scm: +now,
      ver: 11,
      dty: 0,
      usn: 0,
      ls: 0,
      conf: JSON.stringify(defaultConf),
      models: JSON.stringify(models),
      decks: JSON.stringify(decks),
      dconf: JSON.stringify({1: {id: 1, ...defaultDeckConf}}),
      tags: JSON.stringify({}),
    }
    console.log(col)

    db.exec(schema)
    db.prepare(`INSERT INTO col
        (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
        VALUES ($id, $crt, $mod, $scm, $ver, $dty, $usn, $ls, $conf, $models, $decks, $dconf, $tags)`).run(col)

    const insert_notes = db.prepare(
      `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
      VALUES (null, $guid, $mid, $mod, $usn, $tags, $flds, $sfld, 0, 0, '')`
    )
    const insert_cards = db.prepare(
      `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
      VALUES (null, $nid, $did, $ord, $mod, $usn, $type, $queue, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`
    )
    for (const deck of this.decks) {
      for (const note of deck.notes) {
        const {lastInsertRowid: note_id} = insert_notes.run({
          guid: note.guid,
          mid: note.model.props.id,
          mod: (+now/1000)|0,
          usn: -1,
          tags: '',
          flds: note.fields.join('\x1f'),
          sfld: 0,
        })
        for (const card_ord of note.cards) {
          insert_cards.run({
            nid: note_id,
            did: deck.id,
            ord: card_ord,
            mod: (+now/1000)|0,
            usn: -1,
            type: MODEL_STD,
            queue: 0, // -1 for suspended
          })
        }
      }
    }
  }
}

module.exports = {
  Model,
  Package,
  Deck
}
