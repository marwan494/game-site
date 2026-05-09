import os
from flask import Flask

app = Flask(__name__)

@app.route("/")
def home():
    return """
    <html>
    <head>
        <title>🎮 Game Hub</title>
        <style>
            body {
                font-family: Arial;
                background: #0f0f0f;
                color: white;
                text-align: center;
                margin: 0;
            }

            header {
                background: #1f1f1f;
                padding: 20px;
                font-size: 24px;
            }

            .container {
                display: flex;
                justify-content: center;
                flex-wrap: wrap;
                margin-top: 30px;
            }

            .card {
                background: #222;
                margin: 15px;
                padding: 20px;
                width: 220px;
                border-radius: 12px;
                transition: 0.3s;
            }

            .card:hover {
                transform: scale(1.05);
                background: #2c2c2c;
            }

            a {
                color: #00ff88;
                text-decoration: none;
                font-weight: bold;
            }
        </style>
    </head>

    <body>
        <header>🎮 Game Hub - أفضل موقع ألعاب مجاني</header>

        <div class="container">
            <div class="card">
                <h3>🧠 لعبة الذكاء</h3>
                <a href="/game1">العب الآن</a>
            </div>

            <div class="card">
                <h3>🏎️ لعبة السباق</h3>
                <a href="/game2">العب الآن</a>
            </div>

            <div class="card">
                <h3>🎯 لعبة التصويب</h3>
                <a href="/game3">العب الآن</a>
            </div>
        </div>
    </body>
    </html>
    """

@app.route("/game1")
def game1():
    return "<h1>🧠 لعبة الذكاء</h1><p>فكر في رقم من 1 إلى 10 🔥</p>"

@app.route("/game2")
def game2():
    return "<h1>🏎️ لعبة السباق</h1><p>سباق سيارات ممتع 🚗💨</p>"

@app.route("/game3")
def game3():
    return "<h1>🎯 لعبة التصويب</h1><p>اضرب الهدف بدقة 💥</p>"

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
