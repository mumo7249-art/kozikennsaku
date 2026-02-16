# Vercel デプロイガイド (NDL考古学探索システム)

このプロジェクトを Vercel にデプロイして、常にアクセス可能な状態にする手順です。

## ステップ 1: GitHub リポジトリの作成

1. [GitHub](https://github.com/) にアクセスし、新しいリポジトリを作成します。
2. ローカルプロジェクトで以下のコマンドを実行し、GitHub にプッシュします（`<your-url>` は作成したリポジトリのURLに置き換えてください）。

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin <your-url>
git push -u origin main
```

## ステップ 2: Vercel へのデプロイ

1. [Vercel ダッシュボード](https://vercel.com/dashboard) にログインします。
2. **「Add New...」→「Project」** をクリックします。
3. ステップ1で作成した GitHub リポジトリをインポートします。
4. **Environment Variables** (環境変数) の設定セクションを開き、以下の変数を追加します：

   - **Name**: `GEMINI_API_KEY`
   - **Value**: あなたの Gemini API キー

5. 「Deploy」ボタンをクリックします。

## ステップ 3: 動作確認

- デプロイが完了すると、`https://your-project-name.vercel.app` のようなURLが発行されます。
- ブラウザでそのURLを開き、チャット機能が正常に動作し、NDL資料が検索できるか確認してください。

---

### 注意事項
- **`.env.local` はプッシュしないでください**: セキュリティのため、APIキーを含むファイルは Git の管理外（`.gitignore` に記載済み）になっています。必ず Vercel の管理画面から環境変数を設定してください。
- **無料枠の制限**: Vercel のホビープランには実行時間の制限があります。非常に長い検索や回答生成を行う場合、タイムアウトが発生する可能性がありますが、現在の実装（Gemini 1.5 Flash）は高速なため、通常は問題ありません。
