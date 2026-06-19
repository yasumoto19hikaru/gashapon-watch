# gashapon-watch

ガシャポン店舗ページの本文差分を検知して、ntfyに通知するGitHub Actions用botです。

## 監視対象

https://gashapon.jp/shop/gplus_list.php?product_code=4582769911538

## 通知先

ntfy topic:

```txt
gashapon-morizo-kikkoro-yasumoto-20260620-a8f3k29q
```

## GitHubで必要な設定

Repository → Settings → Secrets and variables → Actions → New repository secret

Name:

```txt
NTFY_TOPIC
```

Value:

```txt
gashapon-morizo-kikkoro-yasumoto-20260620-a8f3k29q
```

## 手動実行

GitHub → Actions → Watch Gashapon Page → Run workflow

## 実行頻度

.github/workflows/watch.yml により、毎時11分/41分に実行します。

```yaml
- cron: "11,41 * * * *"
```

## ローカルで動かす場合

```bash
cp .env.example .env
npm install
npx playwright install chromium
npm run check
```

初回は `state/snapshot.json` を保存するだけで通知しません。
2回目以降、差分があるとntfyへ通知します。
