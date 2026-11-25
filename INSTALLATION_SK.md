# Inštalácia XHouse Gate do Homey

## 1. Čo potrebuješ

- Homey Pro s Homey OS `12.3.0` alebo novším
- počítač s Windows, macOS alebo Linuxom
- Node.js 24 alebo novší pre aktuálny Homey CLI
- Docker Desktop, keď chceš použiť diagnostický režim `homey app run` na Homey Pro 2023
- XHouse účet, na ktorom je brána viditeľná a online
- rozbalený priečinok `com.tothk.xhouse`

Home Assistant sa nepoužíva. Komunikácia ide priamo:

```text
Homey Pro -> XHouse/Giigle IoT cloud -> brána
```

## 2. Odporúčaný samostatný XHouse účet

Najbezpečnejšie je nepoužiť hlavný účet z mobilnej aplikácie:

1. Vytvor druhý XHouse účet s iným emailom.
2. Z hlavného účtu mu zdieľaj domácnosť alebo bránu.
3. Over, že druhý účet vie bránu v XHouse aplikácii ovládať.
4. Pri párovaní v Homey použi tento druhý účet.

Dôvod: XHouse môže pri novom prihlásení zneplatniť predchádzajúcu reláciu a odhlásiť mobilnú aplikáciu používajúcu rovnaký účet.

## 3. Nainštaluj Node.js

Použi Node.js 24 alebo novší. Po inštalácii otvor Terminal, PowerShell alebo Command Prompt a over:

```bash
node --version
npm --version
```

## 4. Nainštaluj Homey CLI

```bash
npm install --global homey
```

Over inštaláciu:

```bash
homey --version
```

## 5. Prihlás sa do Homey

```bash
homey login
```

Otvorí sa prehliadač. Prihlás sa Athom/Homey účtom, pod ktorým je tvoj Homey Pro.

Keď máš viac Homey zariadení, vyber správne:

```bash
homey select
```

## 6. Rozbaľ ZIP

Rozbaľ ZIP tak, aby si mal priečinok:

```text
com.tothk.xhouse/
  app.json
  app.js
  drivers/
  lib/
  assets/
```

Potom sa v termináli presuň do tohto priečinka.

### Windows PowerShell – príklad

```powershell
cd "$HOME\Downloads\com.tothk.xhouse"
```

### macOS/Linux – príklad

```bash
cd ~/Downloads/com.tothk.xhouse
```

## 7. Lokálna kontrola balíka

Táto aplikácia nemá externé runtime npm balíky, takže `npm install` nie je potrebný.

Spusti dodané testy:

```bash
npm run validate
```

Potom spusti oficiálnu Homey kontrolu:

```bash
homey app validate
```

## 8. Trvalá inštalácia do Homey

```bash
homey app install
```

Po úspešnom dokončení zostane aplikácia nainštalovaná aj po zatvorení terminálu.

Na dočasné ladenie s live logom sa používa:

```bash
homey app run
```

Na Homey Pro 2023 maj pred spustením tohto príkazu zapnutý Docker Desktop.

Pri `homey app run` sa aplikácia po ukončení príkazu pomocou `Ctrl+C` z Homey odstráni. Na bežné používanie preto použi `homey app install`.

## 9. Aktualizácia z verzie 1.0.2 pri chybe `device.not.exist`

Verzia 1.0.3 zachováva presné 18–19-ciferné XHouse ID. Pri prvom spustení sa pokúsi existujúce zariadenie opraviť automaticky.

1. Ukonči starý `homey app run` cez `Ctrl+C`.
2. Nahraď celý priečinok aplikácie obsahom ZIP-u v1.0.3.
3. Spusti:

```bash
npm run validate
homey app validate
homey app run
```

4. Najprv nechaj existujúci Gate device v Homey. V logu by sa mala objaviť rediscovery a následne obnovenie presného ID.
5. Keď zostane unavailable, použi **Try to Repair** a zadaj účet znova.
6. Až keď Repair zariadenie nenájde jednoznačne, odstráň starý Gate device a pridaj ho znova.

## 10. Pridaj bránu v Homey

V mobilnej alebo webovej aplikácii Homey:

1. Otvor **Devices**.
2. Stlač **+** a vyber **New Device**.
3. Vyhľadaj **XHouse Gate**.
4. Vyber správny typ:
   - **XHouse Gate (EGA/EGB)** pre EGA, EGB alebo experimentálne PGB,
   - **XHouse Garage Opener (XH-SGC01)** pre XH-SGC01.
5. Zadaj XHouse email a heslo.
6. Vyber bránu zo zoznamu.
7. Dokonči pridanie zariadenia.

## 11. Ovládanie

### EGA/EGB/PGB

V detaile zariadenia dostaneš trojpolohové ovládanie:

- **Up** = Open
- **Idle** = Stop
- **Down** = Close

Zobrazuje sa aj:

- stav brány,
- poloha 0–100 %, keď ju model poskytuje,
- poloha ľavého a pravého krídla pri EGA,
- dostupnosť zariadenia.

### XH-SGC01

Používa štandardné Homey ovládanie garážovej brány:

- Open
- Close

Tento model podľa použitého XHouse protokolu neposkytuje samostatný príkaz Stop.

## 12. Flow karty

Pre EGA/EGB/PGB sú dostupné:

### When

- The gate opened
- The gate closed
- The gate started opening
- The gate started closing
- The gate stopped
- The gate came online
- The gate went offline

### And

- The gate state is / is not
- The gate is online / offline

### Then

- Open the gate
- Close the gate
- Stop the gate
- Refresh gate status

Štandardné Flow karty capability `garagedoor_closed` sú dostupné aj pre XH-SGC01.

## 13. Nastavenia zariadenia

V nastaveniach pridaného zariadenia:

- **Refresh interval**: 5 až 300 sekúnd, predvolene 30 sekúnd
- **Debug logging**: zapni iba počas diagnostiky

Po Open/Close/Stop aplikácia automaticky prejde na polling každé 2 sekundy počas 30 sekúnd, aby sa stav v Homey aktualizoval rýchlejšie.

## 14. Oprava prihlasovania

Keď Homey hlási chybu autentifikácie:

1. Otvor nastavenia XHouse zariadenia v Homey.
2. Spusti **Repair**.
3. Znova zadaj XHouse email a heslo.
4. Aplikácia overí, že pôvodné zariadenie je stále dostupné na účte, a uloží nový token.

## 15. Diagnostika

### Po prihlásení sa nezobrazí žiadne zariadenie

- Over správny typ drivera.
- Over, že model obsahuje označenie `EGA`, `EGB`, `PGB` alebo `XH-SGC01`.
- Over, že brána je viditeľná pod rovnakým XHouse účtom.
- Spusti `homey app run`, zapni **Debug logging** a zopakuj pairing.

### Zariadenie je offline

- Skontroluj stav v pôvodnej XHouse aplikácii.
- Skontroluj internetové pripojenie Homey a brány.
- Cloud musí odpovedať na `iemp.giigleiot.net` cez HTTPS.

### Mobilná XHouse aplikácia sa odhlásila

Používaš pravdepodobne ten istý účet. Vytvor druhý účet, zdieľaj mu bránu a v Homey vykonaj **Repair** s novými údajmi.

### Ovládanie funguje, ale stav je Unknown

Model môže používať inú verziu status rámca. Zapni debug log a zachovaj log z `homey app run`; protokol bude potrebné doplniť podľa reálneho rámca zariadenia.

## 16. Odinštalovanie

Aplikáciu môžeš odstrániť priamo v Homey alebo cez CLI. Pri odstránení aplikácie sa odstránia aj jej zariadenia a súvisiace uložené prihlasovacie údaje.
