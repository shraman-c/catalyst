// Seed a large, realistic 60+ node knowledge graph for the Obsidian-style
// graph redesign acceptance test.
// Run: node scripts/seed-large-graph.mjs
import './load-env.mjs';
import postgres from 'postgres';
import { randomUUID, createHash } from 'crypto';
import { hash as argon2Hash } from '@node-rs/argon2';

const sql = postgres(process.env.DATABASE_URL);

function id() { return randomUUID(); }
const now = () => new Date().toISOString();

// Matches src/lib/auth.ts hashPassword: Argon2id PHC string
function hashPassword(password) {
  return argon2Hash(password);
}

// ---------------------------------------------------------------
// Realistic Biology test data — hub-and-spoke topology so the graph
// has clear hubs (large circles) and many leaves (small circles).
// ---------------------------------------------------------------
const HUB_DEFS = [
  { name: 'Cell', def: 'The basic structural and functional unit of all living organisms.', refs: 12 },
  { name: 'DNA', def: 'Deoxyribonucleic acid — the hereditary molecule storing genetic instructions.', refs: 11 },
  { name: 'Protein', def: 'Large biomolecule made of amino acids that performs most cellular functions.', refs: 10 },
  { name: 'Enzyme', def: 'A protein catalyst that accelerates biochemical reactions without being consumed.', refs: 9 },
  { name: 'ATP', def: 'Adenosine triphosphate — the primary energy currency of the cell.', refs: 9 },
  { name: 'Gene', def: 'A sequence of DNA that codes for a protein or functional RNA.', refs: 8 },
  { name: 'Cell Membrane', def: 'Selectively permeable lipid bilayer surrounding the cell.', refs: 8 },
  { name: 'Mitochondria', def: 'Organelle generating ATP via cellular respiration; the powerhouse of the cell.', refs: 7 },
  { name: 'Ribosome', def: 'Molecular machine that synthesizes proteins from mRNA.', refs: 7 },
  { name: 'Photosynthesis', def: 'Process converting light energy into chemical energy in chloroplasts.', refs: 7 },
  { name: 'Nucleus', def: 'Membrane-bound organelle containing the cell\'s chromosomes.', refs: 6 },
  { name: 'Cellular Respiration', def: 'Catabolic process extracting energy from glucose to produce ATP.', refs: 6 },
  { name: 'Chromosome', def: 'Packaged DNA molecule carrying many genes.', refs: 5 },
  { name: 'Mutation', def: 'A heritable change in the DNA sequence.', refs: 5 },
  { name: 'Meiosis', def: 'Cell division producing four haploid gametes.', refs: 4 },
  { name: 'Metabolism', def: 'The sum of all biochemical reactions in an organism.', refs: 4 },
  { name: 'Chloroplast', def: 'Organelle where photosynthesis occurs; contains thylakoids and stroma.', refs: 4 },
  { name: 'Homeostasis', def: 'Maintenance of a stable internal environment.', refs: 3 },
];

const CHILDREN = {
  'Cell': ['Prokaryote', 'Eukaryote', 'Organelle', 'Cytoplasm', 'Cytoskeleton', 'Endoplasmic Reticulum', 'Golgi Apparatus', 'Vacuole', 'Lysosome'],
  'DNA': ['Nucleotide', 'Double Helix', 'Base Pair', 'Adenine', 'Guanine', 'Thymine', 'Cytosine', 'DNA Replication', 'Replication Fork'],
  'Protein': ['Amino Acid', 'Polypeptide', 'Peptide Bond', 'Primary Structure', 'Secondary Structure', 'Tertiary Structure', 'Quaternary Structure', 'Denaturation', 'Protein Folding'],
  'Enzyme': ['Active Site', 'Substrate', 'Catalysis', 'Induced Fit', 'Enzyme Inhibitor', 'Competitive Inhibition', 'Noncompetitive Inhibition', 'Cofactor'],
  'ATP': ['Adenosine Diphosphate', 'Phosphoanhydride Bond', 'Energy Coupling', 'ATP Synthase', 'Hydrolysis', 'Phosphorylation'],
  'Gene': ['Allele', 'Genotype', 'Phenotype', 'Transcription', 'Translation', 'Genetic Code', 'Codon', 'Promoter'],
  'Cell Membrane': ['Phospholipid Bilayer', 'Integral Protein', 'Peripheral Protein', 'Selective Permeability', 'Osmosis', 'Diffusion', 'Active Transport', 'Facilitated Diffusion'],
  'Mitochondria': ['Cristae', 'Matrix', 'Krebs Cycle', 'Electron Transport Chain', 'Oxidative Phosphorylation', 'Pyruvate'],
  'Ribosome': ['Ribosomal RNA', 'Large Subunit', 'Small Subunit', 'Polysome', 'Messenger RNA'],
  'Photosynthesis': ['Light Reactions', 'Calvin Cycle', 'Thylakoid', 'Stroma', 'Chlorophyll', 'NADPH', 'Rubisco'],
  'Nucleus': ['Nuclear Envelope', 'Nucleolus', 'Nuclear Pore', 'Chromatin'],
  'Cellular Respiration': ['Glycolysis', 'Fermentation', 'Lactic Acid', 'Ethanol', 'Acetyl CoA'],
  'Chromosome': ['Chromatid', 'Centromere', 'Telomere', 'Histone', 'Karyotype'],
  'Mutation': ['Point Mutation', 'Insertion', 'Deletion', 'Frameshift', 'Silent Mutation', 'Missense Mutation', 'Nonsense Mutation'],
  'Meiosis': ['Homologous Chromosome', 'Crossing Over', 'Independent Assortment', 'Gamete', 'Tetrad'],
  'Metabolism': ['Anabolism', 'Catabolism', 'Metabolic Pathway', 'Feedback Inhibition'],
  'Chloroplast': ['Thylakoid Membrane', 'Chlorophyll a', 'Chlorophyll b', 'Light Dependent Reactions'],
  'Homeostasis': ['Negative Feedback', 'Positive Feedback', 'Thermoregulation', 'Osmotic Balance'],
};

const EDGE_TYPES = ['part of', 'related to', 'is a type of', 'depends on', 'produces', 'requires'];

async function seed() {
  console.log('🌱 Seeding large knowledge graph...\n');

  const email = 'student@example.com';
  const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
  const userId = existing[0]?.id || id();

  if (!existing[0]) {
    await sql`INSERT INTO users (id, email, name, password_hash, created_at) VALUES (${userId}, ${email}, 'Alex Chen', ${await hashPassword('password123')}, ${now()})`;
  } else {
    // Keep the existing password hash so login still works
    console.log('User exists, keeping credentials.');
  }

  // Clean slate for this user's subjects (graph acceptance test)
  await sql`DELETE FROM subjects WHERE user_id = ${userId}`;

  const subjectId = id();
  await sql`INSERT INTO subjects (id, user_id, name, description, created_at, archived) VALUES (${subjectId}, ${userId}, 'Biology 102 — Cell & Molecular Biology', 'Large test subject: 60+ concepts across cells, genetics, metabolism, and photosynthesis.', ${now()}, FALSE)`;
  console.log(`✅ Subject created: Biology 102 (${subjectId})`);

  // Note files so source-note links exist for a few concepts
  const noteDefs = [
    { filename: 'week01-cells.md', hubs: ['Cell', 'Cell Membrane', 'Organelle'] },
    { filename: 'week02-genetics.md', hubs: ['DNA', 'Gene', 'Chromosome', 'Mutation'] },
    { filename: 'week03-energy.md', hubs: ['ATP', 'Cellular Respiration', 'Photosynthesis', 'Mitochondria'] },
    { filename: 'week04-proteins.md', hubs: ['Protein', 'Enzyme', 'Ribosome'] },
  ];
  const notes = [];
  for (const n of noteDefs) {
    const noteId = id();
    const content = `# ${n.filename}\n\nStudy notes for week.`;
    await sql`INSERT INTO note_files (id, subject_id, filename, content_hash, source, created_at, updated_at) VALUES (${noteId}, ${subjectId}, ${n.filename}, ${createHash('sha256').update(content).digest('hex')}, 'upload', ${now()}, ${now()})`;
    await sql`INSERT INTO note_versions (id, note_file_id, content, created_at) VALUES (${id()}, ${noteId}, ${content}, ${now()})`;
    notes.push({ id: noteId, hubs: n.hubs });
    console.log(`✅ Note created: ${n.filename}`);
  }

  // Create nodes
  const nodeById = new Map(); // name -> node row
  const hubRefs = new Map();
  HUB_DEFS.forEach(h => hubRefs.set(h.name, h.refs));

  for (const hub of HUB_DEFS) {
    nodeById.set(hub.name, { id: id(), name: hub.name, definition: hub.def });
  }
  for (const [hubName, kids] of Object.entries(CHILDREN)) {
    for (const kid of kids) {
      if (!nodeById.has(kid)) {
        nodeById.set(kid, { id: id(), name: kid, definition: `Concept related to ${hubName}.` });
      }
    }
  }

  let refCount = 1;
  for (const [name, node] of nodeById) {
    const refs = hubRefs.get(name) || 1 + (name.length % 4);
    await sql`INSERT INTO graph_nodes (id, subject_id, name, definition, reference_count, manually_edited, created_at, updated_at)
              VALUES (${node.id}, ${subjectId}, ${name}, ${node.definition}, ${refs}, FALSE, ${now()}, ${now()})`;
    refCount++;
  }
  console.log(`✅ Graph nodes created: ${nodeById.size}`);

  // Edges: hub → child ("part of"), hub ↔ hub ("related to" / "depends on"),
  // and a few structured chains to give hubs real degree.
  const edges = [];
  for (const [hubName, kids] of Object.entries(CHILDREN)) {
    const hub = nodeById.get(hubName);
    for (const kid of kids) {
      const k = nodeById.get(kid);
      if (k) edges.push([hub, k, 'part of']);
    }
  }

  const hubPairs = [
    ['DNA', 'Gene', 'contains'], ['Gene', 'Protein', 'encodes'], ['Protein', 'Enzyme', 'is a type of'],
    ['DNA', 'Chromosome', 'part of'], ['Chromosome', 'Meiosis', 'involved in'], ['Gene', 'Mutation', 'affected by'],
    ['Cell', 'Nucleus', 'contains'], ['Cell', 'Mitochondria', 'contains'], ['Cell', 'Ribosome', 'contains'],
    ['Nucleus', 'DNA', 'contains'], ['Mitochondria', 'Cellular Respiration', 'site of'],
    ['Cell Membrane', 'Osmosis', 'governs'], ['Cell Membrane', 'Active Transport', 'governs'],
    ['ATP', 'Cellular Respiration', 'produced by'], ['ATP', 'Photosynthesis', 'produced by'],
    ['ATP', 'Metabolism', 'powers'], ['Mitochondria', 'ATP', 'produces'], ['Chloroplast', 'ATP', 'produces'],
    ['Photosynthesis', 'Chloroplast', 'occurs in'], ['Photosynthesis', 'Cellular Respiration', 'contrasts with'],
    ['Cellular Respiration', 'Glycolysis', 'begins with'], ['Cellular Respiration', 'Fermentation', 'alternates with'],
    ['Enzyme', 'Metabolism', 'regulates'], ['Homeostasis', 'Negative Feedback', 'uses'],
    ['Ribosome', 'Translation', 'site of'], ['Protein', 'Denaturation', 'undergoes'],
    ['DNA', 'DNA Replication', 'undergoes'], ['Nucleus', 'Nucleolus', 'contains'],
  ];
  for (const [a, b, type] of hubPairs) {
    const na = nodeById.get(a);
    const nb = nodeById.get(b);
    if (na && nb) edges.push([na, nb, type]);
  }

  // A few cross-links to raise degree of mid-size concepts
  const extra = [
    ['Glycolysis', 'Pyruvate', 'produces'], ['Krebs Cycle', 'Electron Transport Chain', 'feeds'],
    ['Light Reactions', 'Calvin Cycle', 'provides ATP to'], ['Calvin Cycle', 'Rubisco', 'catalyzed by'],
    ['Transcription', 'Translation', 'precedes'], ['mRNA', 'Codon', 'contains'],
    ['Allele', 'Genotype', 'determines'], ['Histone', 'Chromatin', 'part of'],
  ];
  for (const [a, b, type] of extra) {
    const na = nodeById.get(a);
    const nb = nodeById.get(b);
    if (na && nb) edges.push([na, nb, type]);
  }

  // Link hub→hub with a rotating relationship vocabulary
  for (const [hubA, hubB] of [['Cell', 'DNA'], ['Cell', 'Protein'], ['Cell', 'ATP'], ['Protein', 'Enzyme'], ['Gene', 'Cell'], ['DNA', 'Cell']]) {
    const a = nodeById.get(hubA);
    const b = nodeById.get(hubB);
    if (a && b) edges.push([a, b, EDGE_TYPES[(edges.length) % EDGE_TYPES.length]]);
  }

  let edgeCount = 0;
  for (const [from, to, type] of edges) {
    await sql`INSERT INTO graph_edges (id, subject_id, from_node_id, to_node_id, relationship_type, created_at)
              VALUES (${id()}, ${subjectId}, ${from.id}, ${to.id}, ${type}, ${now()})`;
    edgeCount++;
  }
  console.log(`✅ Graph edges created: ${edgeCount}`);

  // Map notes to hub nodes so source-note links populate the side panel
  for (const note of notes) {
    for (const hubName of note.hubs) {
      const n = nodeById.get(hubName);
      if (n) {
        await sql`INSERT INTO node_note_map (node_id, note_file_id) VALUES (${n.id}, ${note.id}) ON CONFLICT DO NOTHING`;
      }
    }
  }
  console.log('✅ Note-node mappings created');

  // Flashcard links for "study this concept" on hubs
  const cards = [
    ['DNA', 'What is the structure of DNA?', 'DNA is a double helix of two polynucleotide chains held together by complementary base pairs.'],
    ['ATP', 'What does ATP stand for and why is it important?', 'Adenosine triphosphate — the cell\'s main energy currency, releasing energy when its phosphate bonds hydrolyze.'],
    ['Enzyme', 'What is an active site?', 'The region of an enzyme where the substrate binds and catalysis occurs.'],
    ['Mitochondria', 'Where does cellular respiration occur?', 'Mostly in the mitochondria — the Krebs cycle in the matrix and oxidative phosphorylation along the cristae.'],
    ['Cell Membrane', 'What does selectively permeable mean?', 'The membrane allows some substances to pass while blocking others, regulating what enters and leaves the cell.'],
    ['Gene', 'What is a gene?', 'A sequence of DNA that encodes a protein or functional RNA molecule.'],
    ['Mutation', 'What is a frameshift mutation?', 'An insertion or deletion of nucleotides that shifts the reading frame, altering the whole downstream protein sequence.'],
  ];
  for (const [hubName, front, back] of cards) {
    const hub = nodeById.get(hubName);
    const note = notes[0];
    if (hub && note) {
      await sql`INSERT INTO flashcards (id, subject_id, note_file_id, node_ids, front, back, card_type, status, created_at, updated_at, next_review_at, interval, ease_factor, review_count)
                VALUES (${id()}, ${subjectId}, ${note.id}, ${JSON.stringify([hub.id])}, ${front}, ${back}, 'qa', 'accepted', ${now()}, ${now()}, ${now()}, 1, 2.5, 0)`;
    }
  }
  console.log(`✅ Flashcards created: ${cards.length}`);

  console.log('\n🎉 Large graph seeded successfully!');
  console.log(`   Login: student@example.com / password123`);
  console.log(`   Subject ID: ${subjectId}`);
  console.log(`   Nodes: ${nodeById.size} · Edges: ${edgeCount}`);

  await sql.end();
}

seed().catch((e) => { console.error(e); process.exit(1); });
