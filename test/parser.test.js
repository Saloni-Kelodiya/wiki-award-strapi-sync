const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');

const { parseCategories } = require('../lib/parser');

test('parses category blocks with nested winner and nominee lists', () => {
  const $ = cheerio.load(`
    <table class="wikitable defaulttop">
      <tr><td>
        <div><b>Best Picture</b></div>
        <ul><li><b>Anora - Alex Coco</b>
          <ul><li>The Brutalist - Nick Gordon</li><li>A Complete Unknown - Fred Berger</li></ul>
        </li></ul>
      </td></tr>
    </table>
    <table class="wikitable">
      <tr><th>Name(s)</th><th>Role</th></tr>
      <tr><td>Nick Offerman</td><td>Announcer</td></tr>
    </table>
  `);

  assert.deepEqual(parseCategories($), [
    {
      categoryName: 'Best Picture',
      winnerTitle: 'Anora',
      winnerSubTitle: 'Alex Coco',
      NomineesList: [
        { name: 'The Brutalist', subTitle: 'Nick Gordon' },
        { name: 'A Complete Unknown', subTitle: 'Fred Berger' }
      ]
    }
  ]);
});

test('pairs bold category rows with aligned nominee-list cells', () => {
  const $ = cheerio.load(`
    <table class="wikitable">
      <tr>
        <td><div><b>Best Drama</b></div></td>
        <td><div><b>Best Comedy</b></div></td>
      </tr>
      <tr>
        <td><ul><li><b>Drama Winner - Studio A</b></li><li>Drama Nominee - Studio B</li></ul></td>
        <td><ul><li><b>Comedy Winner - Studio C</b></li><li>Comedy Nominee - Studio D</li></ul></td>
      </tr>
    </table>
  `);

  assert.deepEqual(parseCategories($), [
    {
      categoryName: 'Best Drama',
      winnerTitle: 'Drama Winner',
      winnerSubTitle: 'Studio A',
      NomineesList: [{ name: 'Drama Nominee', subTitle: 'Studio B' }]
    },
    {
      categoryName: 'Best Comedy',
      winnerTitle: 'Comedy Winner',
      winnerSubTitle: 'Studio C',
      NomineesList: [{ name: 'Comedy Nominee', subTitle: 'Studio D' }]
    }
  ]);
});