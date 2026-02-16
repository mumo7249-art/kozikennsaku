const axios = require('axios');

const LAB_PAGE_SEARCH_API = 'https://lab.ndl.go.jp/dl/api/page/search';

async function testPageOnlySearch() {
    try {
        console.log('--- Step: Search Pages for "怪談 猫" directly ---');
        // f-book をなしにして、キーワード検索ができるか（Swagger上は必須となっているが、空で試すか別の方法）
        // もし必須なら、キーワードを keyword パラメータとして Book Search に渡し、レスポンスの snippets プロパティを探す

        console.log('Try 1: Book Search with keyword and details...');
        const LAB_BOOK_SEARCH_API = 'https://lab.ndl.go.jp/dl/api/book/search';
        const response = await axios.get(LAB_BOOK_SEARCH_API, {
            params: {
                keyword: '怪談 猫',
                size: 5
            }
        });

        if (response.data.list && response.data.list.length > 0) {
            for (const item of response.data.list) {
                console.log(`Found: [${item.id}] ${item.title}`);
                // snippets は book search のレスポンスに含まれているか？
                if (item.highlights) {
                    console.log(' Highlights:', item.highlights);
                }
            }
        } else {
            console.log('No matches found for "怪談 猫" in Book Search.');
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

testPageOnlySearch();
