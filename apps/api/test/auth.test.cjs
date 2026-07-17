const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'holdout-guest-auth-test-secret';
const { verifyToken } = require('../dist/auth/jwt.util.js');

const guestId = '4f07cc8d-4df8-4c92-9a45-65f417bdbad2';

test('signed guest claims are accepted only with the authoritative guest shape', () => {
  const token = jwt.sign({ sub: `guest:${guestId}`, username: 'Guest-4F07CC', guest: true }, process.env.JWT_SECRET);
  assert.deepEqual(verifyToken(token), {
    sub: `guest:${guestId}`,
    username: 'Guest-4F07CC',
    guest: true,
  });
});

test('guest-prefixed identities cannot masquerade as registered survivors', () => {
  const missingFlag = jwt.sign({ sub: `guest:${guestId}`, username: 'Guest-4F07CC' }, process.env.JWT_SECRET);
  const invalidName = jwt.sign({ sub: `guest:${guestId}`, username: 'Moderator', guest: true }, process.env.JWT_SECRET);
  assert.equal(verifyToken(missingFlag), null);
  assert.equal(verifyToken(invalidName), null);
});

test('registered claims remain compatible and are explicitly non-guest', () => {
  const token = jwt.sign({ sub: 'registered-user-id', username: 'Rook' }, process.env.JWT_SECRET);
  assert.deepEqual(verifyToken(token), {
    sub: 'registered-user-id',
    username: 'Rook',
    guest: false,
  });
});
