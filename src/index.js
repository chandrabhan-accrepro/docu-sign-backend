const express = require("express");
const cors = require("cors");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config();
const docusign = require("docusign-esign");
const bodyParser = require("body-parser");
const fs = require("fs");
const session = require("express-session");
const axios = require("axios");
const moment = require("moment");
const multer = require("multer");

const crypto = require("crypto");

// !used the crypto module, which is a built-in Node.js module, to create an HMAC (Hash-based Message Authentication Code) using the SHA-256 algorithm.

const port = process.env.PORT || 8000;
const app = express();

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

app.use(
  session({
    secret: "dfsf94835asda",
    resave: true,
    saveUninitialized: true,
  })
);

app.post("/form", async (request, response) => {
  try {
    await checkToken(request);
    let envelopesApi = getEnvelopesApi(request);

    console.log(
      "Enveloper Createion info: ",
      request.body.email,
      request.body.name
    );
    let results = await createEnvelope(
      request.body.email,
      request.body.name,
      request.body.subject,
      request.body.emailBody,
      request.body.fileNameForSign,
      envelopesApi
    );
    console.log("envelope results ", results);
    // Create the recipient view, the Signing Ceremony
    let viewRequest = makeRecipientViewRequest(
      request.body.name,
      request.body.email
    );
    console.log("EnvelopeID: ", results.envelopeId);
    const envelopeId = results.envelopeId;
    results = await envelopesApi.createRecipientView(
      process.env.ACCOUNT_ID,
      results.envelopeId,
      { recipientViewRequest: viewRequest }
    );

    response.status(200).json({ url: results.url, envelopeId });
  } catch (err) {
    console.log("Error creating", err.message);
  }
});

function getEnvelopesApi(request) {
  let dsApiClient = new docusign.ApiClient();
  dsApiClient.setBasePath(process.env.BASE_PATH);
  dsApiClient.addDefaultHeader(
    "Authorization",
    "Bearer " + request.session.access_token
  );
  return new docusign.EnvelopesApi(dsApiClient);
}

const createEnvelope = async (
  signerEmail,
  signerName,
  subject,
  emailBody,
  fileNameForSign,
  envelopesApi
) => {
  try {
    // Read the document file and convert it to base64
    const documentContent = fs.readFileSync(
      path.join(__dirname, `documents/${fileNameForSign}`),
      "base64"
    );
    console.log("Document fileName: ", fileNameForSign);
    // console.log("Signer Data", signerEmail, signerName, documentContent);
    // Defined envelope definition with the actual document content
    const envelopeDefinition = {
      emailSubject: subject ? subject : "Please sign this document",
      emailBlurb: emailBody
        ? emailBody
        : "Please review and sign this document attached.",
      status: "sent", // We can also use 'created' to save the envelope as a draft
      documents: [
        {
          documentBase64: documentContent,
          name: fileNameForSign,
          documentId: "1",
        },
      ],
      recipients: {
        signers: [
          {
            email: signerEmail,
            name: signerName,
            recipientId: "1",
            routingOrder: "1",
            tabs: {
              signHereTabs: [
                {
                  anchorString: "SIGN_HERE",
                  anchorUnits: "pixels",
                  anchorXOffset: "0",
                  anchorYOffset: "0",
                },
              ],
            },
          },
        ],
      },
    };

    // Create and send the envelope
    // console.log("Hello world!", process.env.ACCOUNT_ID);
    const results = await envelopesApi.createEnvelope(process.env.ACCOUNT_ID, {
      envelopeDefinition,
    });
    console.log("Results env:", results.envelopeId);
    // Returned envelope status or other relevant data to the frontend
    return { envelopeId: results.envelopeId, status: results.status };
  } catch (error) {
    console.error("Error creating envelope:", error.message);
    return { error: "An error occurred while creating the envelope" };
  }
};

function makeRecipientViewRequest(name, email) {
  let viewRequest = new docusign.RecipientViewRequest();

  viewRequest.returnUrl = "http://localhost:8000/success";
  viewRequest.authenticationMethod = "none";

  // Recipient information must match embedded recipient info
  // we used to create the envelope.
  viewRequest.email = email;
  viewRequest.userName = name;
  viewRequest.clientUserId = process.env.CLIENT_USER_ID;

  return viewRequest;
}

async function checkToken(request) {
  try {
    if (
      request.session.access_token &&
      Date.now() < request.session.expires_at
    ) {
      console.log("re-using access_token ", request.session.access_token);
    } else {
      let dsApiClient = new docusign.ApiClient();
      dsApiClient.setBasePath(process.env.BASE_PATH);
      console.log("generating a new access token: ");
      const results = await dsApiClient.requestJWTUserToken(
        process.env.INTEGRATION_KEY,
        process.env.USER_ID,
        "signature",
        fs.readFileSync(path.join(__dirname, "private.key")),
        3600
      );
      console.log("Result Body data: ", results.body.access_token);
      request.session.access_token = results.body.access_token;
      request.session.expires_at =
        Date.now() + (results.body.expires_in - 60) * 1000;
    }
  } catch (err) {
    console.error("Error: ", err.message);
  }
}

app.post("/getDoc", async (req, res) => {
  try {
    console.log("GET Doc API is Hitted ", req.query.envelopeId);
    const envelopeID = req.query.envelopeId
      ? req.query.envelopeId
      : req.body.envelopeId;
    const documentName = req.body.docName;
    const parts = documentName.split(".");
    const withoutExtensionDocName = parts[0];
    await checkToken(req);
    let dsApiClient = new docusign.ApiClient();
    dsApiClient.setBasePath(process.env.BASE_PATH);
    dsApiClient.addDefaultHeader(
      "Authorization",
      "Bearer " + req.session.access_token
    );
    let envelopesApi = new docusign.EnvelopesApi(dsApiClient),
      results = null;

    // Call Envelopes::get
    // Exceptions will be caught by the calling function
    results = await envelopesApi.getEnvelope(
      process.env.ACCOUNT_ID,
      envelopeID,
      null
    );

    axios({
      method: "get",
      url: `https://demo.docusign.net/restapi/v2/accounts/${process.env.ACCOUNT_ID}/envelopes/${envelopeID}/documents/1`,
      headers: {
        Authorization: `Bearer ${req.session.access_token}`,
      },
      responseType: "stream",
    })
      .then((docuResponse) => {
        // Check if the response status is 200 (OK)
        if (docuResponse.status === 200) {
          // Define the file path and name
          const filename = `${withoutExtensionDocName}_${envelopeID}.pdf`;
          const filePath = `${__dirname}/signed-docs/`;
          const tempFile = path.resolve(filePath, filename);

          // Pipe the response stream to a file
          docuResponse.data.pipe(fs.createWriteStream(tempFile));

          docuResponse.data.on("end", () => {
            // File has been successfully downloaded
            res.status(200).json({ success: true, data: tempFile });
          });

          docuResponse.data.on("error", (err) => {
            // Error in download
            console.error("Error downloading signed document:", err);
            res.status(500).json({
              success: false,
              error: "Failed to download signed document",
            });
          });
        } else {
          // Handle unexpected status codes (e.g., not 200)
          console.error("Unexpected status code:", docuResponse.status);
          res
            .status(500)
            .json({ success: false, error: "Unexpected status code" });
        }
      })
      .catch((error) => {
        // Handle Axios request errors
        console.error("Axios request error:", error);
        res.status(500).json({ success: false, error: "Axios request error" });
      });
    console.log("Results:", results);
    // console.log("Document Data: ", documentResponse.data);
    // res.status(200).json({ results });
  } catch (err) {
    console.log(err);
    res.status(500).json({ err: err });
  }
});

app.get("/checkstatus", async (req, res) => {
  try {
    const envelopeID = req.query.envelopId;
    await checkToken(req);
    let dsApiClient = new docusign.ApiClient();
    dsApiClient.setBasePath(process.env.BASE_PATH);
    dsApiClient.addDefaultHeader(
      "Authorization",
      "Bearer " + req.session.access_token
    );
    let envelopesApi = new docusign.EnvelopesApi(dsApiClient);
    let results = null;

    // Call Envelopes::get
    // Exceptions will be caught by the calling function
    results = await envelopesApi.getEnvelope(
      process.env.ACCOUNT_ID,
      envelopeID,
      null
    );
    console.log(results);
    res.status(200).json({ results: results });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err });
  }
});

app.get("/", async (request, response) => {
  await checkToken(request);
  response.json({
    success: `Check token successfully returned ${request.session.access_token}`,
  });
});
// https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=cdd45316-d679-47bd-9deb-d8183d635570&redirect_uri=http://localhost:5173/

app.get("/success", (request, response) => {
  response.send("Successfully Completed Signing Process!");
});

// !for getting real time notifications

app.get("/statusenveloper", async (req, res) => {
  try {
    await checkToken(req);
    let dsApiClient = new docusign.ApiClient();
    dsApiClient.setBasePath(process.env.BASE_PATH);
    dsApiClient.addDefaultHeader(
      "Authorization",
      "Bearer " + req.session.access_token
    );
    let envelopesApi = new docusign.EnvelopesApi(dsApiClient);
    let results = null;

    // List the envelopes
    // The Envelopes::listStatusChanges method has many options
    // See https://developers.docusign.com/esign-rest-api/reference/Envelopes/Envelopes/listStatusChanges

    let options = { fromDate: moment().subtract(30, "days").format() };

    // Exceptions will be caught by the calling function
    results = await envelopesApi.listStatusChanges(
      process.env.ACCOUNT_ID,
      options
    );
    console.log("Listing status changes: ", results);
    res.status(200).json({ results });
  } catch (error) {
    console.log("Error: ", error.message);
    res.status(500).json({ error });
  }
});

app.get("/api/v1/getPdfs", (req, res) => {
  try {
    const pdfFolder = path.join(__dirname, "signed-docs"); // Replace with your folder path

    // Read all files in the PDF folder
    fs.readdir(pdfFolder, (err, files) => {
      if (err) {
        // Handle any error that occurs while reading the folder
        console.error(err.message);
        res.status(500).send("Internal Server Error");
      } else {
        // Filter only PDF files
        const pdfFiles = files.filter((file) =>
          file.toLowerCase().endsWith(".pdf")
        );

        // Set the Content-Type header to indicate that it's a PDF file
        res.setHeader("Content-Type", "application/pdf");
        // console.log(pdfFiles);
        // Send all PDF files as a response
        const allLinks = [];
        pdfFiles.forEach((filename) => {
          const filePath = path.join(pdfFolder, filename);
          // console.log(filePath);
          allLinks.push(
            filename
            // `<a href="http://localhost:8000/api/v1/getPdf/${filename}">${filename}</a><br>`
          );
        });
        console.log(allLinks);
        res.status(200).json({ result: allLinks });
      }
    });
  } catch (error) {
    console.log("error: ", error.message);
    res.status(500).json({ error: error });
  }
});

app.get("/api/v1/getPdf/:filename", (req, res) => {
  const pdfFolder = path.join(__dirname, "signed-docs");
  const { filename } = req.params;
  const filePath = path.join(pdfFolder, filename);
  console.log(pdfFolder);
  // Check if the file exists
  if (fs.existsSync(filePath)) {
    // Set the Content-Type header to indicate that it's a PDF file
    res.setHeader("Content-Type", "application/pdf");

    // Send the PDF file as a response
    console.log(filePath);
    res.sendFile(filePath);
  } else {
    // Handle the case where the file does not exist
    res.status(404).send("File not found");
  }
});
app.get("/api/getDocuments", (req, res) => {
  try {
    const pdfFolder = path.join(__dirname, "documents"); // Replace with your folder path

    // Read all files in the PDF folder
    fs.readdir(pdfFolder, (err, files) => {
      if (err) {
        // Handle any error that occurs while reading the folder
        console.error(err.message);
        res.status(500).send("Internal Server Error");
      } else {
        // Filter only PDF files
        const pdfFiles = files.filter((file) =>
          file.toLowerCase().endsWith(".pdf")
        );

        // Set the Content-Type header to indicate that it's a PDF file
        res.setHeader("Content-Type", "application/pdf");
        // console.log(pdfFiles);
        // Send all PDF files as a response
        const allLinks = [];
        pdfFiles.forEach((filename) => {
          const filePath = path.join(pdfFolder, filename);
          // console.log(filePath);
          allLinks.push(
            filename
            // `<a href="http://localhost:8000/api/v1/getPdf/${filename}">${filename}</a><br>`
          );
        });
        console.log(allLinks);
        res.status(200).json({ result: allLinks });
      }
    });
  } catch (error) {
    console.log("error: ", error.message);
    res.status(500).json({ error: error });
  }
});
app.get("/api/getDocuments/:filename", (req, res) => {
  const pdfFolder = path.join(__dirname, "documents");
  const { filename } = req.params;
  const filePath = path.join(pdfFolder, filename);
  console.log(pdfFolder);
  // Check if the file exists
  if (fs.existsSync(filePath)) {
    // Set the Content-Type header to indicate that it's a PDF file
    res.setHeader("Content-Type", "application/pdf");

    // Send the PDF file as a response
    console.log(filePath);
    res.sendFile(filePath);
  } else {
    // Handle the case where the file does not exist
    res.status(404).send("File not found");
  }
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "documents/"));
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage: storage });

app.post("/uploadnewfile", upload.single("file"), (req, res) => {
  res.status(200).json({ message: "File uploaded successfully" });
});

//! getting the single pdf------------------------------
// app.get("/api/v1/getPdf", function (req, res) {
//   const file = path.join(
//     __dirname,
//     "signed-docs/Docu-sign-implementatio_2376c015-3f0f-486d-89bf-f5c0b3987163.pdf"
//   );
//   // Set the Content-Type header to indicate that it's a PDF file
//   res.setHeader("Content-Type", "application/pdf");

//   // Send the PDF file as a response
//   res.sendFile(file);
// });

app.listen(port, (err) => {
  console.log("successfully listening on port " + port);
});
