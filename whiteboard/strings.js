// The Whiteboard's own English words (the drawing engine brings its own).
// build.mjs writes these into i18n/en.json inside the app and checks that every
// other language has the same keys.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.WB = root.WB || {}).EN = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    'title': 'Whiteboard',
    'opening': 'Opening…',
    'failed': 'The whiteboard could not start.',
    'rail': 'Workshop tools',
    'note': 'Sticky note',
    'note.text': 'Note',
    'note.pick': 'Pick a colour for the new note',
    'color.yellow': 'Yellow',
    'color.pink': 'Pink',
    'color.blue': 'Blue',
    'color.green': 'Green',
    'color.orange': 'Orange',
    'color.purple': 'Purple',
    'hl': 'Highlighter',
    'vote': 'Add my dot to what is selected',
    'unvote': 'Take my dot back',
    'vote.pick': 'Select a note first, then add your dot.',
    'vote.none': 'You have no dot there.',
    'timer': 'Timer',
    'timer.min': '{n, plural, one {# minute} other {# minutes}}',
    'timer.stop': 'Stop the timer',
    'timer.done': 'Time is up',
    'timer.left': '{time} left',
    'templates': 'Frames and templates',
    'tpl.frame': 'Empty frame (one slide)',
    'tpl.brainstorm': 'Brainstorm',
    'tpl.retro': 'Retrospective',
    'tpl.b.q': 'How might we…?',
    'tpl.b.ideas': 'Ideas',
    'tpl.b.themes': 'Themes',
    'tpl.b.top': 'Top picks',
    'tpl.r.good': 'Went well',
    'tpl.r.bad': 'To improve',
    'tpl.r.act': 'Actions',
    'frame.name': 'Frame {n}',
    'export': 'Export',
    'export.pptx': 'PowerPoint (.pptx), one slide per frame',
    'export.png': 'Picture (.png) of this frame',
    'export.pdf': 'PDF, one page per frame',
    'export.working': 'Making the file…',
    'export.done': 'Saved {name}',
    'export.fail': 'The file could not be made.',
    'export.empty': 'The board is empty.',
    'people': '{n, plural, one {# person on this board} other {# people on this board}}',
    'guest': 'Guest',
    'status.saved': 'All changes are shared',
    'status.saving': 'Sharing your changes…',
    'status.waiting': 'Waiting for the person who shared this board. Your changes are kept and will be sent.',
    'close': 'Close'
  };
});
