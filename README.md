# Wikipedia → Strapi Award Sync

Wikipedia ke award-show pages se data (title, poster, categories, winners,
nominees) fetch karke aapke Strapi `awards` collection me automatically
create karne ki script.

## ⚠️ Zaroori baat pehle

Wikipedia ke har award-show page ka table layout thoda different hota hai.
Ye script **best-effort parsing** karti hai — zyadatar Filmfare/Oscar/Emmy
style pages ke liye achha kaam karegi, lekin **Strapi admin me entry create
hone ke baad ek baar check zaroor kar lena**, khaas kar categories aur
nominees. Jo cheez parse nahi ho paati, console me warning print hoti hai.

---

## Setup (ek baar karna hai)

1. Is folder ko apne computer pe le jao (jahan Node.js installed ho, version 18+).

2. Dependencies install karo:
   ```bash
   npm install
   ```

3. `.env.example` ko copy karke `.env` banao:
   ```bash
   cp .env.example .env
   ```

4. `.env` file me apna Strapi URL aur API token daalo:
   ```
   STRAPI_URL=http://localhost:1337
   STRAPI_TOKEN=<Strapi admin > Settings > API Tokens > Create > Full Access>
   ```

5. `config.js` file kholo aur `INDUSTRY_MAP` section me apne Strapi
   `category` collection ke **real IDs** daalo (Bollywood, Hollywood, TV,
   OTT, jo bhi bana rakhe hain). ID dhoondhne ke liye:
   - Strapi admin → Content Manager → Category → kisi entry pe click karo
   - Browser URL me last number hi uska id hai
     (e.g. `.../category.category/5` → id = 5)

---

## Use karna

Ek award show:
```bash
node index.js https://en.wikipedia.org/wiki/68th_Filmfare_Awards
```

Multiple award shows ek saath (batch — ek-ek karke process honge):
```bash
node index.js \
  https://en.wikipedia.org/wiki/68th_Filmfare_Awards \
  https://en.wikipedia.org/wiki/96th_Academy_Awards \
  https://en.wikipedia.org/wiki/75th_Primetime_Emmy_Awards
```

Script har URL ke liye:
1. Wikipedia summary + HTML fetch karti hai
2. Infobox se title/date/location/host nikalti hai
3. `wikitable` tables se categories/winners/nominees parse karti hai
4. Main poster image download karke Strapi media library me upload karti hai
5. Sab data ek `POST /api/awards` call me Strapi me create kar deti hai

---

## Kya cheez abhi automatic NAHI hai (jaanbuujh kar off rakhi hai)

- **Winner aur nominee ki individual photos** — off by default
  (`config.js` me `FETCH_WINNER_IMAGES` / `FETCH_NOMINEE_IMAGES`), kyunki
  isse har category ke har naam ke liye ek extra Wikipedia call lagti hai
  aur script bahut slow ho jaati hai. Baad me chaaho to ye logic add kar
  sakte hain.
- **totalNominations / countriesRepresented** — Wikipedia pages me ye
  info consistently nahi milti, isliye blank chhodi jaati hai; chaho to
  manually Strapi admin me bhar sakte ho.
- **categoryDescription** — Wikipedia usually nahi deta, blank rehta hai.

---

## Troubleshooting

- **"STRAPI_TOKEN is not set"** → `.env` file check karo, token sahi
  paste hua hai ya nahi.
- **"Strapi create failed (400)"** → Strapi console me exact error dikhega
  (field type mismatch ho sakta hai, e.g. `date` invalid format). Terminal
  output me poora error body print hota hai.
- **"No categories auto-detected"** → Us specific Wikipedia page ka table
  layout standard se hat kar hai. `lib/parser.js` me `parseCategories`
  function ko us page ke hisaab se tweak karna padega, ya manually Strapi
  me categories add karo.
- **Strapi `industry_category` empty aa raha hai** → `config.js` me
  `INDUSTRY_MAP` ke keywords check karo, ya `DEFAULT_CATEGORY_ID` set karo.
