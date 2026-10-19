/* Tip GifOS Creators — the smallest possible seller.
 *
 * One call: gifos.charge() with an editable amount and no sku. The OS shows
 * its own approval sheet (verified author, amount, rail choice) — this app
 * never sees a card, a wallet, or a balance, and keeps no record of anything.
 * DECLINED_BY_USER is kept by name. On the current OS it is "No thanks"
 * before any order. The released OS also used that name when it stopped
 * looking after the PayPal window closed. Those two cannot be told apart
 * here, so that name is never shown as "nothing was charged."
 */
(function () {
  'use strict';
  var MIN_USD = 3;
  var selected = 10;

  var $ = function (id) { return document.getElementById(id); };
  var sendBtn = $('send'), note = $('note'), thanks = $('thanks'), custom = $('custom-usd');

  function currentUsd() {
    var v = Number(custom.value);
    if (custom.value !== '' && isFinite(v)) return Math.floor(v);
    return selected;
  }
  function supportLine(msg) {
    var line = 'Questions about this payment? support@gifos.app';
    if (String(msg || '').indexOf('support@gifos.app') !== -1) return String(msg || '');
    return (msg ? String(msg) + ' ' : '') + line;
  }
  function paint() {
    var usd = currentUsd();
    var ok = usd >= MIN_USD;
    sendBtn.disabled = !ok;
    sendBtn.textContent = ok ? 'Send a $' + usd + ' tip' : 'Tips start at $' + MIN_USD;
  }

  $('amounts').addEventListener('click', function (e) {
    var b = e.target.closest('.amt');
    if (!b) return;
    selected = Number(b.dataset.usd);
    custom.value = '';
    var all = document.querySelectorAll('.amt');
    for (var i = 0; i < all.length; i++) all[i].classList.toggle('sel', all[i] === b);
    paint();
  });
  custom.addEventListener('input', paint);

  sendBtn.addEventListener('click', function () {
    var usd = currentUsd();
    if (usd < MIN_USD) return;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Waiting for your approval…';
    // Base units: $1 = 1000000 (the one unit space both rails share).
    gifos.charge({
      amount: String(usd) + '000000',
      reason: 'Tip the GifOS creators',
      editable: true
    }).then(function (receipt) {
      thanks.hidden = false;
      var how = { paypal: ' by PayPal.', x402: ' in USDC.', transfer: ' in USDC.', fednow: ' from your bank.' };
      $('thanks-line').textContent = supportLine('Your tip went through' +
        (how[receipt && receipt.rail] || '.') +
        ' It goes straight to the people who build GifOS.');
      sendBtn.hidden = true; note.hidden = true;
      paint();
    }).catch(function (err) {
      var msg = String(err && err.message || err || '');
      // DECLINED_BY_USER on the current OS is "No thanks" before any order.
      // The released OS also used that same name when it stopped looking
      // after the PayPal window closed, which is a payment it had not
      // checked. This app cannot tell those apart, so it does not claim
      // the money was not taken.
      var declined = /DECLINED_BY_USER/.test(msg);
      note.textContent = declined
        ? supportLine('GifOS did not record a payment. If you approved one in PayPal, that charge is real — check your PayPal activity before trying again.')
        : supportLine(msg);
      sendBtn.disabled = false;
      paint();
    });
  });

  $('again').addEventListener('click', function () {
    thanks.hidden = true; sendBtn.hidden = false; note.hidden = false;
    note.textContent = 'You’ll approve the payment on the next screen — it names who receives it, and you can still change the amount or say no there.';
    paint();
  });

  paint();
})();
