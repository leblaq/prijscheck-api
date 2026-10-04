import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;


/* =========================
   TEST ROUTE
========================= */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Prijscheck API werkt"
  });
});


/* =========================
   PRIJS CHECK
========================= */

app.post("/api/prijscheck", async (req, res) => {

  try {

    const {
      kenteken,
      buitenlands,
      soortschade,
      prijs_via,
      telefoon,
      email,
      merk,
      model,
      bouwjaar,
      captchaToken
    } = req.body;


    /* =========================
       BASISCONTROLE
    ========================= */

    if (!kenteken) {
      return res.status(400).json({
        ok: false,
        error: "Kenteken ontbreekt"
      });
    }

    if (!soortschade) {
      return res.status(400).json({
        ok: false,
        error: "Soort schade ontbreekt"
      });
    }

    if (!prijs_via) {
      return res.status(400).json({
        ok: false,
        error: "Prijs ontvangen via ontbreekt"
      });
    }

    if (!captchaToken) {
      return res.status(400).json({
        ok: false,
        error: "reCAPTCHA ontbreekt"
      });
    }


    /* =========================
       RECAPTCHA SECRET
    ========================= */

    const secret =
      process.env.RECAPTCHA_SECRET_KEY;

    if (!secret) {

      console.error(
        "RECAPTCHA_SECRET_KEY ontbreekt"
      );

      return res.status(500).json({
        ok: false,
        error: "Server configuratiefout"
      });

    }


    /* =========================
       RECAPTCHA CONTROLEREN
    ========================= */

    const params =
      new URLSearchParams();

    params.append(
      "secret",
      secret
    );

    params.append(
      "response",
      captchaToken
    );


    const captchaResponse =
      await fetch(
        "https://www.google.com/recaptcha/api/siteverify",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded"
          },
          body: params.toString()
        }
      );


    const captchaResult =
      await captchaResponse.json();


    if (!captchaResult.success) {

      console.log(
        "reCAPTCHA afgekeurd:",
        captchaResult
      );

      return res.status(400).json({
        ok: false,
        error: "reCAPTCHA controle mislukt"
      });

    }


    /* =========================
       GELDIGE AANVRAAG
    ========================= */

    console.log(
      "Geldige aanvraag:",
      {
        kenteken,
        buitenlands,
        soortschade,
        prijs_via,
        telefoon,
        email,
        merk,
        model,
        bouwjaar
      }
    );


    return res.json({
      ok: true,
      message: "reCAPTCHA geldig"
    });


  } catch (error) {

    console.error(
      "Prijscheck fout:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "Interne serverfout"
    });

  }

});


/* =========================
   START SERVER
========================= */

app.listen(
  PORT,
  () => {

    console.log(
      `Prijscheck API draait op poort ${PORT}`
    );

  }
);
