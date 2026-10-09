![cover](docs/images/activitywatch-logic-cover.webp)

<p align="center">
  <a href="https://ai.mr-asa.com/blog/activitywatch-interface-ru.html"><img src="docs/images/blog-button.svg" height="28" alt="Описание в блоге" /></a>
  &nbsp;│&nbsp;
  <a href="README.md"><img src="https://img.shields.io/badge/English-4b5563?style=for-the-badge" alt="English" /></a>
  <a href="README.ru.md"><img src="https://img.shields.io/badge/%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9-65d6b4?style=for-the-badge" alt="Русский" /></a>
</p>

---

### Узнайте, куда уходит время, проведённое у монитора.

ActivityWatch Projects превращает историю ActivityWatch в понятную картину времени по проектам: без таймеров, которые нужно запускать, и без ввода тегов или правил по каждой активности изо дня в день!

![Дашборд ActivityWatch Projects](docs/images/dashboard.png)


## Как начать

Нужен запущенный [ActivityWatch](https://activitywatch.net/) с вотчерами окон и AFK. Для правил по сайтам установите ещё браузерное расширение ActivityWatch.

1. **Установите.** Выберите систему:

   <details open>
   <summary><b>Windows</b> (PowerShell)</summary>

   ```powershell
   irm https://github.com/mr-asa/activitywatch-projects/releases/latest/download/install.ps1 | iex
   ```

   Ставится в `%LOCALAPPDATA%/ActivityWatchProjects`.
   </details>

   <details>
   <summary><b>Linux</b></summary>

   ```sh
   curl -fsSL https://github.com/mr-asa/activitywatch-projects/releases/latest/download/install.sh | sh
   ```

   Ставится в `~/.local/share/activitywatch-projects` (нужны `curl` или `wget` и `unzip`).
   </details>

   <details>
   <summary><b>macOS</b></summary>

   Та же команда, что и для Linux. Ставится в `~/Library/Application Support/ActivityWatchProjects`. Кнопки Update в один клик там нет: для обновления запустите команду снова.
   </details>

   <details>
   <summary><b>Вручную</b> (любая система)</summary>

   Скачайте `activitywatch-projects.zip` из [релизов](https://github.com/mr-asa/activitywatch-projects/releases), распакуйте папку `app` куда угодно и добавьте `projects = "<эта папка>"` в секцию `[server.custom_static]` файла `aw-server.toml`.
   </details>

   Скрипт скачает последний релиз и добавит одну строку в `aw-server.toml` ActivityWatch (сначала делается резервная копия).
2. **Один раз перезапустите ActivityWatch** и откройте <http://127.0.0.1:5600/pages/projects/>.
3. Нажмите **+ Add project**, задайте имя и правило, и история начнёт заполняться.

**Обновления.** Раз в сутки панель проверяет GitHub и, если вышла новая версия, показывает плашку с кнопкой **Update**: один клик устанавливает обновление и перезагружает страницу (Windows и Linux). Если кнопка ничего не делает, запустите команду установки ещё раз.

Проверено на Windows с ActivityWatch 0.14. На других платформах должно работать, но не проверялось.

## Скорость работы

Открывайте ActivityWatch по адресу `http://127.0.0.1:5600`, а не `localhost:5600`. В Windows `localhost` сначала пробует IPv6, а ActivityWatch слушает только IPv4, поэтому каждый запрос теряет около 200 мс. Для панели, которая делает несколько запросов подряд, это секунды: первая загрузка отчёта ускоряется примерно с 3,3 до 0,3 с. Так быстрее работает и весь интерфейс ActivityWatch.

Настройки вида (период графика, фильтры, параметры экспорта) и кэш графика браузер хранит отдельно для каждого адреса, поэтому на новом адресе они сначала будут пустыми. Проекты, правила и пресеты хранятся в ActivityWatch и не зависят от адреса.

## Для разработчиков

Архитектура, модель данных, тесты и деплой описаны в [AGENTS.md](AGENTS.md) (на английском).
