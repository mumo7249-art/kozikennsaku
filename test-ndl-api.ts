import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';

const API_ENDPOINT = 'https://ndlsearch.ndl.go.jp/api/opensearch';
const LAB_SEARCH_API = 'https://lab.ndl.go.jp/dl/api/page/search';

async function testNDLSearch() {
  try {
    console.log('--- NDL OpenSearch API Test ---');
    // 「江戸 怪談」でインターネット公開資料を検索
    // mediatail: 9 (デジタル化資料) を追加して絞り込む
    const response = await axios.get(API_ENDPOINT, {
      params: {
        any: '江戸 怪談',
        dpid: 'open',
        cnt: 5,
      }
    });

    const parser = new XMLParser();
    const jsonObj = parser.parse(response.data);
    const items = jsonObj.rss.channel.item;

    if (!items) {
      console.log('No items found.');
      return;
    }

    const firstItem = Array.isArray(items) ? items[0] : items;
    console.log('Title:', firstItem.title);
    console.log('Link:', firstItem.link);
    console.log('Guid (PID):', firstItem.guid);

    // PIDの抽出 (例: info:ndljp/pid/1234567 -> 1234567)
    const pidMatch = firstItem.guid.match(/pid\/(\d+)/);
    if (pidMatch) {
      const pid = pidMatch[1];
      console.log('Extracted PID:', pid);

      console.log('\n--- NDL Lab Page API Test ---');
      const labResponse = await axios.get(LAB_SEARCH_API, {
        params: {
          'f-book': pid,
          'q-contents': '猫',
        }
      });

      if (labResponse.data && labResponse.data.length > 0) {
        console.log('Found snippets:', labResponse.data.length);
        console.log('First Snippet Page (コマ):', labResponse.data[0].page);
        console.log('Snippet Text:', labResponse.data[0].snippet);
      } else {
        console.log('No snippets found for "猫" in this book.');
      }
    }

  } catch (error) {
    console.error('Error during API test:', error);
  }
}

testNDLSearch();
