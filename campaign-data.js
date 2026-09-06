(() => {
  const defaults = {
    title: "Help Single Mom Fight Stage 4 Lung and Brain Cancer",
    intro: "Jessica has never smoked, yet she is fighting Stage 4 lung cancer that has spread to her brain. Her daughter is asking for help with radiation, targeted therapy, scans, co-pays, and medical expenses.",
    goal: 50000,
    raised: 515,
    status: "Urgent appeal",
    organizerName: "B Yvonne",
    organizerRole: "Daughter · Campaign organiser",
    photo: "/assets/jessica-family.png",
    story: "My mother, who has never smoked, is battling Stage 4 lung cancer that has spread to her brain. We need help with her treatments, co-pays, and other medical bills. The last thing I want is for my mother to worry about how she will pay for care while fighting for her life.\n\nHere is a message from my mother:\n\nHello. I am reaching out to ask for help. This is incredibly hard for me because I have always done everything on my own.\n\nOn September 18, 2019, I was in a serious car accident and totaled my car. Earlier that same day, my spouse passed away from oral cancer. When paramedics took me to the hospital, doctors performed around 20 X-rays and discovered a nodule in my left lung. They advised me to have it checked.\n\nOver the following months, I underwent a PET scan, bronchoscopy, CT scan, and biopsy. On September 18, 2020, it was confirmed that the lung nodule was cancer. That day, my world turned upside down.\n\nOn October 28, 2020, I had one-third of my lung removed. Doctors also removed eight lymph nodes, and one tested positive for cancer. Since then, I have faced serious infections, fluid around my heart, and severe pain.\n\nI am currently taking Tagrisso, a targeted therapy for non-small cell lung cancer, and I am experiencing many side effects. During treatment, I need frequent breathing tests, echocardiograms, CT scans, X-rays, and PET scans. Every scan comes with a co-pay.\n\nMy latest scans showed that the cancer has spread to my brain and has returned in my lungs near my heart. Doctors found a growing spot in my brain and confirmed that it is cancer. I now need to begin radiation treatment for my brain soon.\n\nIf you can help with any amount, I would be deeply grateful. I would also appreciate your prayers. I know prayers do work.\n\nThank you so much, and God bless you.",
    tiers: [
      { amount: 25, title: "Cover a Medical Co-pay", description: "Helps with a scan, appointment, or prescription co-pay", badge: "" },
      { amount: 50, title: "Provide Daily Medicine", description: "Supports medication, symptom relief, and care essentials", badge: "" },
      { amount: 75, title: "Give a Full Care Day", description: "Provides transport, meals, medication, and support around one treatment day", badge: "RECOMMENDED" },
      { amount: 100, title: "Strengthen Her Treatment", description: "Makes a meaningful contribution toward radiation, targeted therapy, and scans", badge: "" },
      { amount: 200, title: "Double Her Treatment Support", description: "Provides twice the support across radiation, scans, prescriptions, and medical bills", badge: "URGENT SUPPORT" },
      { amount: 500, title: "Be Her Treatment Lifeline", description: "Provides major support across radiation, targeted therapy, scans, co-pays, and recovery.", badge: "MAX IMPACT" }
    ],
    faqs: [
      { question: "Where does my donation go?", answer: "Donations support radiation treatment, targeted therapy, medical scans, prescriptions, co-pays, transport, and other related medical expenses." },
      { question: "Is my payment secure?", answer: "The checkout is designed for a secure payment provider. This local preview does not process or store card details." },
      { question: "What happens after I donate?", answer: "After a successful live payment, donors receive a confirmation and the campaign total can be updated by the organizer." },
      { question: "Can I cancel or refund my donation?", answer: "Refund requests should be handled by the campaign organizer according to the connected payment provider's policy." },
      { question: "What if you raise more than the goal?", answer: "Any amount beyond the goal will continue supporting Jessica's treatment, recovery, and related family expenses." },
      { question: "How do I know this is real?", answer: "Campaign verification details and organizer updates should be published here as they become available." }
    ],
    messages: [
      { name: "Eun Ju Jeong", amount: 50, date: "8 mos", message: "Hi Mom, I'll pray for you and your complete recovery daily. My mom also had lung and brain cancer, so I understand a little bit of what you're going through. I hope you never give up, and thank you for being strong." },
      { name: "Chelsea Velasquez", amount: 25, date: "1 yr", message: "Sending so much love and light! We are all in your corner cheering you on! Never forget you are superwoman and you are a warrior ❤️" },
      { name: "Anon Donor", amount: 50, date: "1 yr", message: "Hey mom, I know I'm just some random stranger on the internet, but I've been following your story for some time. I want to say how much I look up to you and your strength. My grandmother was also diagnosed with cancer, and I'm struggling to cope with it. You give me so much hope. Know that I keep you in my prayers for your healing and long life. You're strong, amazing, and loved. I'm rooting and praying for you always." },
      { name: "Kyler R", amount: 50, date: "2 yrs", message: "Hi Jessica. I understand your doctors are doing all they can, but I highly recommend the Center for New Medicine in Irvine, California. May the Lord bless and keep you, shine his face upon you, and bring you peace." }
    ]
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const merge = (stored = {}) => ({
    ...clone(defaults),
    ...stored,
    tiers: Array.isArray(stored.tiers) ? stored.tiers : clone(defaults.tiers),
    faqs: Array.isArray(stored.faqs) ? stored.faqs : clone(defaults.faqs),
    messages: Array.isArray(stored.messages) ? stored.messages : clone(defaults.messages)
  });

  window.CloudyCampaignDefaults = defaults;
  window.CloudyCampaignStore = {
    key: "cloudyCampaignData",
    load() {
      try {
        const stored = JSON.parse(localStorage.getItem(this.key) || "null");
        return merge(stored && typeof stored === "object" ? stored : {});
      } catch {
        return clone(defaults);
      }
    },
    save(value) {
      const normalized = merge(value);
      localStorage.setItem(this.key, JSON.stringify(normalized));
      window.dispatchEvent(new CustomEvent("cloudy:campaign-updated", { detail: normalized }));
      return normalized;
    },
    reset() {
      localStorage.removeItem(this.key);
      return clone(defaults);
    }
  };
})();
