/**
 * mkanki - generate decks for the Anki spaced-repetition software.
 * Copyright (c) 2018  Jeremy Apthorp <nornagon@nornagon.net>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License (version 3) as
 * published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
const fs = require('fs')

const tmp = require('tmp')
const archiver = require('archiver')

const ankiHash = require('./anki_hash')

const MODEL_STD = 0
const MODEL_CLOZE = 1

class Model {
  constructor(props) {
    this.props = {
      ...defaultModel,
      ...props,
      flds: props.flds.map((f, i) => ({...defaultField, ord: i, ...f})),
      tmpls: props.tmpls.map((t, i) => ({...defaultTemplate, ord: i, name: `Card ${i+1}`, ...t})),
    }
    this.fieldNameToOrd = {}
    this.props.flds.forEach(f => { this.fieldNameToOrd[f.name] = f.ord })
  }

  note(fields, guid = null) {
    if (Array.isArray(fields)) {
      if (fields.length !== this.props.flds.length) {
        throw new Error(`Expected ${this.props.flds.length} fields for model '${this.props.name}' but got ${fields.length}`)
      }
      return new Note(this, fields, guid)
    } else {
      const field_names = Object.keys(fields)
      const fields_list = []
      field_names.forEach(field_name => {
        const ord = this.fieldNameToOrd[field_name]
        if (ord == null) throw new Error(`Field '${field_name}' does not exist in the model`)
        fields_list[ord] = fields[field_name]
      })
      return new Note(this, fields_list, guid)
    }
  }
}

class ClozeModel extends Model {
  constructor(props) {
    super({
      type: MODEL_CLOZE,
      css: `
        .card {
          font-family: arial;
          font-size: 20px;
          text-align: center;
          color: black;
          background-color: white;
        }

        .cloze {
          font-weight: bold;
          color: blue;
        }
      `,
      tmpls: [{name: "Cloze", ...props.tmpl}],
      ...props
    })
  }
}

const defaultModel = {
  sortf: 0, // sort field
  did: 1, // deck id
  latexPre: `\\documentclass[12pt]{article}
\\special{papersize=3in,5in}
\\usepackage[utf8]{inputenc}
\\usepackage{amssymb,amsmath}
\\pagestyle{empty}
\\setlength{\\parindent}{0in}
\\begin{document}`,
  latexPost: "\\end{document}",
  mod: 0, // modification time
  usn: 0, // unsure, something to do with sync?
  vers: [], // seems to be unused
  type: MODEL_STD,
  css: `.card {
 font-family: arial;
 font-size: 20px;
 text-align: center;
 color: black;
 background-color: white;
}`,
  /* also:
  name: string,
  flds: [Field],
  tmpls: [Template],
  tags: [??],
  id: string
  */
  tags: [],
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

class Deck {
  constructor(id, name) {
    this.id = id
    this.name = name
    this.notes = []
  }

  addNote(note) {
    this.notes.push(note)
  }
}


class Note {
  constructor(model, fields, guid = null) {
    this.model = model
    this.fields = fields
    this._guid = guid
  }

  get guid() {
    return this._guid ? this._guid : ankiHash(this.fields);
  }

  get cards() {
    if (this.model.props.type === MODEL_STD) {
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
    } else {
      // the below logic is copied from anki's ModelManager._availClozeOrds
      const ords = new Set()
      const matches = []
      const curliesRe = /{{[^}]*?cloze:(?:[^}]?:)*(.+?)}}/g
      const percentRe = /<%cloze:(.+?)%>/g
      const {qfmt} = this.model.props.tmpls[0] // cloze models only have 1 template
      let m;
      while (m = curliesRe.exec(qfmt))
        matches.push(m[1])
      while (m = percentRe.exec(qfmt))
        matches.push(m[1])
      const map = {}
      this.model.props.flds.forEach((fld, i) => {
        map[fld.name] = [i, fld]
      })
      for (const fname of matches) {
        if (!(fname in map)) continue
        const ord = map[fname][0]
        const re = /{{c(\d+)::.+?}}/gs
        while (m = re.exec(this.fields[ord])) {
          const i = parseInt(m[1])
          if (i > 0)
            ords.add(i - 1)
        }
      }
      if (ords.size === 0) {
        // empty clozes use first ord
        return [0]
      }
      return Array.from(ords)
    }
  }
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

const defaultDeck = {
  newToday: [0, 0], // currentDay, count
  revToday: [0, 0],
  lrnToday: [0, 0],
  timeToday: [0, 0], // time in ms
  conf: 1,
  usn: 0,
  desc: "",
  dyn: 0,  // anki uses int/bool interchangably here
  collapsed: false,
  // added in beta11
  extendNew: 10,
  extendRev: 50,
}

class Package {
  constructor() {
    this.decks = []
    this.media = []
  }

  addDeck(deck) {
    this.decks.push(deck)
  }

  addMedia(data, name) {
    this.media.push({name, data})
  }

  addMediaFile(filename, name = null) {
    this.media.push({name: name || filename, filename})
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
    const media_info = {}
    this.media.forEach((m, i) => {
      if (m.filename != null) archive.file(m.filename, { name: i.toString() })
      else archive.append(m.data, { name: i.toString() })
      media_info[i] = m.name
    })
    archive.append(JSON.stringify(media_info), { name: 'media' })
    archive.finalize()
  }

  write(db) {
    const now = new Date
    const models = {}
    const decks = {}
    this.decks.forEach(d => {
      d.notes.forEach(n => models[n.model.props.id] = n.model.props)
      decks[d.id] = {
        ...defaultDeck,
        id: d.id,
        name: d.name,
      }
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
            type: 0, // 0=new, 1=learning, 2=due 
            queue: 0, // -1 for suspended
          })
        }
      }
    }
  }
}

module.exports = {
  Model,
  ClozeModel,
  Package,
  Deck
}

// dumped from an anki export with the sqlite3 cli's '.schema' command
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
    type            integer not null,      /* 6 */  /* 0=new, 1=learning, 2=due */
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
