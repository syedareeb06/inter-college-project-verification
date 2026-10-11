/* ProjectLedger - built-in sample project reports (all fictional) and the demo seed plan.
 * Shared by the web app (window.ProjectLedgerSamples) and blockchain/scripts/deploy.js (require). */
(function (root) {
  // Colleges are accounts 1-4 of the demo chain; account 0 is the University Consortium Board.
  const COLLEGES = [
    { account: 1, name: "Riverside Institute of Technology", code: "RIT" },
    { account: 2, name: "Northgate College of Engineering", code: "NCE" },
    { account: 3, name: "Lakeview Polytechnic", code: "LVP" },
    { account: 4, name: "Hillcrest School of Computing", code: "HSC" },
  ];

  const DOMAINS = [
    "IoT & Agriculture",
    "Machine Learning",
    "Computer Vision",
    "Mobile & Biometrics",
    "Data Science",
    "Embedded & Healthcare",
    "Web & Recommender Systems",
    "Cyber Security",
    "Blockchain",
    "Other",
  ];

  const SAMPLES = [
    {
      key: "irrigation",
      college: 1,
      title: "Smart Irrigation Controller using Soil Moisture Sensors and LoRa",
      domain: "IoT & Agriculture",
      year: 2025,
      guide: "Prof. A. Menon",
      members: [
        ["Aditya Kulkarni", "21RIT014"],
        ["Riya Menon", "21RIT027"],
        ["Sanjay Pillai", "21RIT033"],
      ],
      body: `Abstract
Small farms in dry districts lose a large part of their water to fixed-schedule irrigation. Pumps run at the same hour every day whether the soil is wet or dry, and farmers rarely have data about how much water each plot really needs. This project builds a low-cost irrigation controller that measures soil moisture in several zones of a field, sends the readings over a LoRa radio link to a gateway, and switches the pump valves only when a zone falls below its target moisture level.

Problem statement
Existing drip systems are timer based. Commercial smart controllers exist but cost more than a small farmer earns in a season and depend on mobile data, which is weak in rural areas. We wanted a controller that costs less than four thousand rupees per zone, works without the internet, and runs for a full season on a small solar panel.

System design
Each field zone has a sensor node built around an ATmega328 microcontroller, a capacitive soil moisture probe, a DS18B20 temperature sensor and an SX1276 LoRa module. The node wakes up every fifteen minutes, takes five moisture samples, discards the highest and lowest, and transmits the average together with battery voltage. The gateway is an ESP32 board with its own LoRa module. It keeps a moisture threshold for every zone, opens the matching solenoid valve through a relay board when the reading drops below the threshold, and closes it again when the soil reaches the upper limit. A simple hysteresis band of eight percent prevents the valves from switching on and off repeatedly.

Calibration
Capacitive probes give a raw value that depends on soil type. We calibrated every probe with two reference points, completely dry soil from an oven and fully saturated soil, and stored the linear mapping in the node's EEPROM. Red soil and black cotton soil needed different curves, so the gateway lets the farmer choose the soil type for each zone.

Results
The prototype ran for nine weeks on a tomato plot of half an acre divided into four zones. Compared with the neighbouring plot on a fixed morning schedule, water use fell by thirty-one percent while the yield stayed within three percent. LoRa packets reached the gateway from three hundred and eighty metres with a packet loss below two percent. The sensor nodes used a 2000 mAh battery charged by a one watt solar panel and never ran flat.

Conclusion
A sensor-driven controller with a long-range radio link can save a third of irrigation water on small farms at low cost. Future work includes weather forecast input, a local display for the farmer and a mobile dashboard for when connectivity is available.`,
    },
    {
      key: "pothole",
      college: 2,
      title: "Crowd-Sourced Pothole Detection from Smartphone Accelerometer Data",
      domain: "Machine Learning",
      year: 2025,
      guide: "Dr. S. Rao",
      members: [
        ["Neha Joshi", "21NCE008"],
        ["Farhan Qureshi", "21NCE019"],
        ["Meera Iyer", "21NCE041"],
      ],
      body: `Abstract
Road agencies learn about potholes mostly from citizen complaints, which arrive late and without exact locations. This project turns ordinary smartphones mounted in buses and auto-rickshaws into road survey instruments. An Android app records the three-axis accelerometer and GPS while the vehicle moves, detects the sharp vertical jolts caused by potholes, and uploads only the detected events with their coordinates to a server that clusters repeated reports into a public map.

Data collection
We collected eighty hours of driving data on city roads with phones fixed in dashboard holders. Two team members marked potholes, speed breakers and railway crossings with a button in the app, which gave us labelled windows for training. Readings were sampled at fifty hertz and split into one-second windows with fifty percent overlap.

Feature extraction and model
For each window we computed the mean, standard deviation, maximum and minimum of the vertical axis after reorienting the phone axes with the gravity vector, along with the vehicle speed from GPS. Speed matters because the same pothole produces a smaller jolt at low speed. A random forest with one hundred trees separated potholes from speed breakers and normal road. Speed breakers were the hardest class because they also produce a strong vertical movement, but their longer and smoother shape gave a lower peak-to-duration ratio.

Clustering and map
A single detection can be a false alarm, so the server groups events within fifteen metres using DBSCAN and publishes a pothole only after three independent vehicles report it. Each confirmed pothole receives a severity score from the average jolt size. Municipal staff can mark a pothole as repaired, and it disappears from the map when no new reports arrive for two weeks.

Results
On a held-out set of twelve hours the classifier reached a precision of 0.91 and a recall of 0.86 for potholes. After clustering, ninety-four percent of the published potholes were confirmed by a manual survey of the same roads. Battery drain stayed under six percent per hour of driving because the app processes windows on the phone and sends only events.

Conclusion
Low-cost phones already present in public transport can map road damage continuously. Future work covers night-time operation, detection of road cracks with the camera and integration with the municipal complaint portal.`,
    },
    {
      key: "solar",
      college: 3,
      title: "Dust Detection on Solar Panels using Image Processing",
      domain: "Computer Vision",
      year: 2024,
      guide: "Prof. R. Bhat",
      members: [
        ["Rahul Desai", "20LVP005"],
        ["Kavya Shenoy", "20LVP012"],
      ],
      body: `Abstract
Dust on photovoltaic panels can reduce output by twenty percent or more in dry seasons, yet most rooftop installations are cleaned on a fixed monthly schedule. This project estimates the dust level of each panel from a camera image and recommends cleaning only when the expected energy loss is larger than the cost of cleaning.

Approach
A fixed camera on a pole photographs the array every morning. We first locate each panel with edge detection and a perspective transform so that every panel becomes a flat rectangle. Inside each rectangle we measure the brightness and texture of the glass. Clean glass shows the dark cells and the silver busbars with sharp contrast, while a dusty panel looks lighter and blurred. We combined the mean grey level, the local contrast and a Laplacian sharpness value into a dust index between zero and one.

Ground truth
To relate the index to energy loss we fitted current sensors to six panels of a college rooftop plant and cleaned three of them every day while leaving the other three dusty. The difference in daily energy between the cleaned and the dusty panels gave the real loss, which grew almost linearly with the dust index.

Cleaning decision
The system converts the predicted loss into rupees using the local tariff and compares it with the cost of one cleaning visit. It sends a message to the maintenance staff only when cleaning pays for itself within a week. Rain days reset the dust estimate because rain cleans the panels naturally.

Results
Over a ten-week trial the dust index predicted the measured energy loss with a mean absolute error of 1.8 percent. Following the recommendations, the plant needed five cleaning visits instead of ten while losing only 0.7 percent more energy than with daily cleaning. Shadows from nearby trees in the late afternoon confused the index, so photographs are taken only between eight and ten in the morning.

Conclusion
A single camera and simple image features are enough to schedule panel cleaning by need instead of by calendar. Next steps include a drone for large ground-mounted plants and a small neural network to separate dust from bird droppings and shadows.`,
    },
    {
      key: "dropout",
      college: 1,
      title: "Predicting Student Dropout Risk with Gradient Boosting",
      domain: "Data Science",
      year: 2024,
      guide: "Prof. L. Fernandes",
      members: [
        ["Varun Rao", "20RIT011"],
        ["Sneha Bhatt", "20RIT024"],
      ],
      body: `Abstract
Students who leave an engineering programme usually show warning signs one or two semesters earlier: falling attendance, failed internal tests and unpaid fees. This project predicts the dropout risk of each student from anonymised academic records so that mentors can contact students in time.

Data
The college examination cell provided eight years of anonymised records for about four thousand students. Every student is identified only by a random number. For each semester we have internal test marks, attendance percentage, number of backlogs, fee payment delay, hostel or day scholar status and distance from home. A student counts as a dropout if they left without completing the degree.

Model
We compared logistic regression, a random forest and gradient boosted trees using five-fold cross-validation grouped by admission year so that the model never trains on the future. Gradient boosting gave the best area under the ROC curve, 0.87, against 0.81 for logistic regression. Class imbalance was large because only nine percent of students dropped out, so we used class weights instead of oversampling.

Explaining predictions
Mentors will not trust a bare score, so every prediction lists the three features that pushed the risk up most, computed with SHAP values. The most important signals were backlogs in the first year, a drop in attendance between two semesters and fee payment delays longer than sixty days.

Dashboard
A small web dashboard shows each mentor the students in their group sorted by risk, with the explanation and a record of previous counselling meetings. Scores are refreshed after every internal test.

Ethics
The model is used only to offer help, never to decide admissions or penalties. Sensitive attributes such as gender and caste were excluded from the features, and we checked that the error rates were similar across groups.

Results
In a pilot semester, mentors contacted the forty students with the highest risk. Twenty-nine of them continued into the next semester, compared with about half in earlier years for students with similar records, although a single semester is too short to prove the effect.

Conclusion
Early warning from routine academic data is accurate enough to guide mentoring. Future work will add library and laboratory usage and a longer evaluation.`,
    },
    {
      key: "attendance",
      college: 4,
      title: "Offline-First Classroom Attendance App with Face Recognition",
      domain: "Mobile & Biometrics",
      year: 2025,
      guide: "Dr. P. Nair",
      members: [
        ["Imran Sheikh", "21HSC003"],
        ["Divya Nambiar", "21HSC017"],
        ["Arjun Hegde", "21HSC022"],
        ["Pooja Kamath", "21HSC030"],
      ],
      body: `Abstract
Paper attendance registers take ten minutes of every lecture and are easy to fake with proxy signatures. This project replaces them with an Android app that takes one photograph of the classroom, recognises the students' faces on the phone itself, and synchronises the attendance with the college server whenever a network is available.

Design goals
Many classrooms have no reliable Wi-Fi, and student photographs are personal data, so recognition had to work completely offline and no face images should leave the phone. The app also had to run on the inexpensive phones that faculty members already own.

Recognition pipeline
A lightweight face detector finds every face in the group photograph. Each face is aligned using five landmarks and passed to a compact embedding network that produces a vector of one hundred and twenty-eight numbers. During enrolment each student records three short selfies, and the app stores only the averaged embedding vector, encrypted with a key held by the department. At attendance time every detected face is matched with the nearest enrolled vector, and matches above a distance limit are shown to the teacher for confirmation instead of being marked automatically.

Synchronisation
Attendance records are saved in a local database with a timestamp and the teacher's signature. When the phone reaches the campus network, the app uploads the records and resolves conflicts by keeping the earliest confirmed entry for each student and lecture.

Results
In a pilot with four sections of sixty students, the app recognised ninety-six percent of the students present from a single photograph taken from the front of the room. Students sitting behind others or wearing masks were the main misses; the teacher confirmed them manually in a few seconds. Taking attendance dropped from about nine minutes to under one minute per lecture.

Privacy and limitations
Only embedding vectors are stored, and they cannot be turned back into photographs easily. Students who do not consent can be marked manually. Lighting in evening lectures reduced accuracy, so the app asks for a second photograph when too few faces are found.

Conclusion
On-device face recognition makes attendance fast and resistant to proxies without sending photographs to a server.`,
    },
    {
      key: "ecg",
      college: 2,
      title: "Low-Cost Wearable ECG Monitor with Arrhythmia Alerts",
      domain: "Embedded & Healthcare",
      year: 2026,
      guide: "Dr. V. Shetty",
      members: [
        ["Karthik Gowda", "22NCE006"],
        ["Ananya Das", "22NCE015"],
        ["Rohit Patil", "22NCE029"],
      ],
      body: `Abstract
Patients recovering from heart problems in small towns rarely have access to continuous ECG monitoring after they leave hospital. This project builds a chest-worn single-lead ECG monitor that costs under three thousand rupees, detects common arrhythmias on the device, and alerts a family member's phone over Bluetooth.

Hardware
The monitor uses an AD8232 analogue front end with three gel electrodes, an nRF52832 microcontroller with Bluetooth Low Energy and a 500 mAh lithium battery. The signal is sampled at 250 hertz. A right-leg drive circuit and a hardware band-pass filter between 0.5 and 40 hertz reduce mains interference and baseline wander caused by breathing.

Signal processing
On the microcontroller, a Pan-Tompkins style detector finds the R peaks: the signal is differentiated, squared and integrated over a moving window, and adaptive thresholds pick the peaks. From the intervals between beats the firmware computes heart rate and its variability. Atrial fibrillation is suspected when the beat intervals become irregular for thirty seconds, and bradycardia or tachycardia when the rate stays below fifty or above one hundred and twenty beats per minute.

Alerts and app
The companion Android app receives a summary every minute and the raw signal only around an event, which keeps the Bluetooth link and the battery load small. When an alert fires, the app shows the ECG strip, vibrates, and sends a text message with the location to two emergency contacts. Doctors can export a PDF report of the week for review.

Testing
We tested the detector on recordings from a public arrhythmia database and on ten volunteers during rest and walking. R peak detection reached a sensitivity of 99.1 percent on clean recordings and 96.4 percent while walking. Atrial fibrillation episodes longer than thirty seconds were detected with a sensitivity of 92 percent and one false alarm per eleven hours on average. The battery lasted fifty-two hours between charges.

Conclusion
A low-cost wearable with on-device detection can give continuous cardiac monitoring outside hospital. It is a screening aid, not a diagnostic device, and would need clinical validation before use with patients.`,
    },
    {
      key: "irrigation-copy",
      college: 3,
      copyOf: "irrigation",
      title: "IoT-Based Automated Farm Irrigation with Soil Moisture Sensing over LoRa",
      domain: "IoT & Agriculture",
      year: 2026,
      guide: "Prof. K. Dsouza",
      members: [
        ["Vikram Shetty", "22LVP009"],
        ["Nisha Rao", "22LVP018"],
      ],
      body: `Abstract
Small farms in drought-prone districts waste a large share of their water because of fixed-schedule irrigation. Pumps run at the same time every day whether the soil is wet or dry, and growers rarely have data about how much water each plot really needs. This project develops a low-cost irrigation controller that measures soil moisture in several zones of a farm, sends the readings over a LoRa radio link to a gateway, and switches the pump valves only when a zone falls below its target moisture level.

Problem statement
Existing drip systems are timer based. Commercial smart controllers exist but cost more than a small farmer earns in a season and depend on mobile data, which is weak in villages. Our aim was a controller that costs less than four thousand rupees per zone, works without the internet, and runs for a full season on a small solar panel.

Proposed system
Every field zone has a sensor node built around an ATmega328 microcontroller, a capacitive soil moisture probe, a DS18B20 temperature sensor and an SX1276 LoRa module. The node wakes up every fifteen minutes, takes five moisture samples, discards the highest and lowest, and transmits the average together with battery voltage. The gateway is an ESP32 board with its own LoRa module. It keeps a moisture threshold for every zone, opens the matching solenoid valve through a relay board when the reading drops below the threshold, and closes it again when the soil reaches the upper limit. A hysteresis band of eight percent prevents the valves from switching on and off repeatedly.

Calibration
Capacitive probes give a raw value that depends on soil type. Every probe was calibrated with two reference points, fully dry soil from an oven and fully saturated soil, and the linear mapping was stored in the node's EEPROM. Red soil and black cotton soil needed different curves, so the gateway lets the farmer choose the soil type for each zone.

Results
The prototype was tested for eight weeks on a chilli plot of half an acre split into four zones. Compared with the adjacent plot on a fixed morning schedule, water consumption fell by twenty-nine percent while the yield stayed within four percent. LoRa packets reached the gateway from three hundred and fifty metres with a packet loss below two percent. The sensor nodes used a 2000 mAh battery charged by a one watt solar panel and never ran out of charge.

Conclusion
A sensor-driven controller with a long-range radio link can save nearly a third of irrigation water on small farms at low cost. Future work includes weather forecast input, a local display for the farmer and a mobile dashboard when connectivity is available.`,
    },
    {
      key: "library",
      college: 4,
      title: "Library Book Recommendation using Collaborative Filtering",
      domain: "Web & Recommender Systems",
      year: 2026,
      guide: "Prof. J. George",
      members: [
        ["Zara Khan", "22HSC004"],
        ["Manoj Kumar", "22HSC021"],
      ],
      body: `Abstract
College libraries hold thousands of books, but most students borrow only the titles listed in their syllabus. This project recommends books to each student from the borrowing history of students with similar interests, using the library's existing circulation records.

Data
The library management system exported four years of anonymised issue records: a random student number, the book accession number, the issue date and the return date. After removing reference books that cannot be borrowed, the data held about sixty-two thousand loans of nine thousand titles by three thousand students.

Method
We built a student-by-book matrix in which a cell is one if the student borrowed the book. Item-based collaborative filtering computes the cosine similarity between books from the students who borrowed both; a student then receives the books most similar to those they already borrowed. New students have no history, so for them the system falls back to the most borrowed books of their branch and semester. To avoid recommending only bestsellers, the score of very popular books is reduced with an inverse frequency weight.

Evaluation
We hid the last two loans of every student and checked whether they appeared in the top ten recommendations. Item-based filtering placed at least one hidden book in the top ten for thirty-eight percent of students, compared with nineteen percent for the most-popular baseline. Recommendations crossing departments, such as statistics books for mechanical students in a data analytics elective, were among the most appreciated in a short survey.

Web interface
Students log in with their library card number and see recommendations next to the search box, with a short reason such as "borrowed by students who also read this". Librarians can see which recommended books are often unavailable and use that list when ordering new copies.

Conclusion
Circulation data that libraries already collect is enough to build useful recommendations. Future work includes the e-book platform, reading lists from faculty and a mobile app.`,
    },
  ];

  /** The full report text whose SHA-256 goes on-chain (title line + body, LF line endings). */
  const reportText = (s) => `${s.title}\n\n${s.body}`.replace(/\r\n?/g, "\n").trim();

  /** Projects registered when the demo chain is created (ids 1..5), and who endorses them.
   *  The ECG monitor, the library recommender and the reworded irrigation copy are left for the live demo. */
  const SEED_PLAN = [
    { key: "irrigation", endorsers: [2, 3] }, // #1 Riverside, Verified
    { key: "pothole", endorsers: [4] }, //       #2 Northgate, Verified
    { key: "solar", endorsers: [1] }, //         #3 Lakeview, Verified
    { key: "dropout", endorsers: [4] }, //       #4 Riverside, Verified
    { key: "attendance", endorsers: [] }, //     #5 Hillcrest, awaiting endorsement
  ];

  const api = { COLLEGES, DOMAINS, SAMPLES, SEED_PLAN, reportText, sample: (key) => SAMPLES.find((s) => s.key === key) };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ProjectLedgerSamples = api;
})(typeof window !== "undefined" ? window : globalThis);
