export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ai_providers: {
        Row: {
          base_url: string
          created_at: string
          created_by: string
          id: string
          is_default: boolean
          is_enabled: boolean
          key_hint: string
          last_test_message: string | null
          last_test_status: string
          last_tested_at: string | null
          model: string
          name: string
          organization_id: string
          protocol: Database["public"]["Enums"]["ai_api_protocol"]
          updated_at: string
          updated_by: string
        }
        Insert: {
          base_url: string
          created_at?: string
          created_by: string
          id?: string
          is_default?: boolean
          is_enabled?: boolean
          key_hint: string
          last_test_message?: string | null
          last_test_status?: string
          last_tested_at?: string | null
          model: string
          name: string
          organization_id: string
          protocol: Database["public"]["Enums"]["ai_api_protocol"]
          updated_at?: string
          updated_by: string
        }
        Update: {
          base_url?: string
          created_at?: string
          created_by?: string
          id?: string
          is_default?: boolean
          is_enabled?: boolean
          key_hint?: string
          last_test_message?: string | null
          last_test_status?: string
          last_tested_at?: string | null
          model?: string
          name?: string
          organization_id?: string
          protocol?: Database["public"]["Enums"]["ai_api_protocol"]
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_providers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          after_data: Json | null
          before_data: Json | null
          entity_id: string | null
          entity_type: string
          id: number
          occurred_at: string
          organization_id: string | null
          request_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: never
          occurred_at?: string
          organization_id?: string | null
          request_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: never
          occurred_at?: string
          organization_id?: string | null
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_articles: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          archived_at: string | null
          archived_by: string | null
          audiences: Database["public"]["Enums"]["brand_audience"][]
          category: Database["public"]["Enums"]["brand_category"]
          change_note: string
          created_at: string
          created_by: string
          do_list: string[]
          dont_list: string[]
          edit_version: number
          examples: string | null
          guidelines: string
          id: string
          organization_id: string
          reference_urls: string[]
          status: Database["public"]["Enums"]["brand_article_status"]
          summary: string
          title: string
          topic_id: string
          updated_at: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          archived_at?: string | null
          archived_by?: string | null
          audiences?: Database["public"]["Enums"]["brand_audience"][]
          category: Database["public"]["Enums"]["brand_category"]
          change_note: string
          created_at?: string
          created_by: string
          do_list?: string[]
          dont_list?: string[]
          edit_version?: number
          examples?: string | null
          guidelines: string
          id?: string
          organization_id: string
          reference_urls?: string[]
          status?: Database["public"]["Enums"]["brand_article_status"]
          summary: string
          title: string
          topic_id?: string
          updated_at?: string
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          archived_at?: string | null
          archived_by?: string | null
          audiences?: Database["public"]["Enums"]["brand_audience"][]
          category?: Database["public"]["Enums"]["brand_category"]
          change_note?: string
          created_at?: string
          created_by?: string
          do_list?: string[]
          dont_list?: string[]
          edit_version?: number
          examples?: string | null
          guidelines?: string
          id?: string
          organization_id?: string
          reference_urls?: string[]
          status?: Database["public"]["Enums"]["brand_article_status"]
          summary?: string
          title?: string
          topic_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "brand_articles_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_articles_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_articles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_articles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_assets: {
        Row: {
          content_item_id: string
          created_at: string
          created_by: string
          id: string
          kind: Database["public"]["Enums"]["content_asset_kind"]
          notes: string | null
          organization_id: string
          stage: Database["public"]["Enums"]["content_step"] | null
          title: string
          url: string
        }
        Insert: {
          content_item_id: string
          created_at?: string
          created_by: string
          id?: string
          kind: Database["public"]["Enums"]["content_asset_kind"]
          notes?: string | null
          organization_id: string
          stage?: Database["public"]["Enums"]["content_step"] | null
          title: string
          url: string
        }
        Update: {
          content_item_id?: string
          created_at?: string
          created_by?: string
          id?: string
          kind?: Database["public"]["Enums"]["content_asset_kind"]
          notes?: string | null
          organization_id?: string
          stage?: Database["public"]["Enums"]["content_step"] | null
          title?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_assets_content_org_fkey"
            columns: ["content_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "content_assets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_brand_references: {
        Row: {
          brand_article_id: string
          content_item_id: string
          created_at: string
          created_by: string
          organization_id: string
        }
        Insert: {
          brand_article_id: string
          content_item_id: string
          created_at?: string
          created_by: string
          organization_id: string
        }
        Update: {
          brand_article_id?: string
          content_item_id?: string
          created_at?: string
          created_by?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_brand_references_article_org_fkey"
            columns: ["brand_article_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "brand_articles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "content_brand_references_content_org_fkey"
            columns: ["content_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "content_brand_references_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_brand_references_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_items: {
        Row: {
          brand_notes: string | null
          copy_brief: string
          created_at: string
          created_by: string
          cta: string
          design_brief: string
          editing_brief: string
          format: Database["public"]["Enums"]["content_format"]
          goal: string
          hook: string
          id: string
          intake_request: string | null
          intake_source_url: string | null
          organization_id: string
          platforms: string[]
          publish_at: string
          published_at: string | null
          script_outline: string
          status: Database["public"]["Enums"]["content_status"]
          thumbnail_brief: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          brand_notes?: string | null
          copy_brief?: string
          created_at?: string
          created_by?: string
          cta: string
          design_brief?: string
          editing_brief?: string
          format?: Database["public"]["Enums"]["content_format"]
          goal: string
          hook: string
          id?: string
          intake_request?: string | null
          intake_source_url?: string | null
          organization_id: string
          platforms?: string[]
          publish_at: string
          published_at?: string | null
          script_outline?: string
          status?: Database["public"]["Enums"]["content_status"]
          thumbnail_brief?: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          brand_notes?: string | null
          copy_brief?: string
          created_at?: string
          created_by?: string
          cta?: string
          design_brief?: string
          editing_brief?: string
          format?: Database["public"]["Enums"]["content_format"]
          goal?: string
          hook?: string
          id?: string
          intake_request?: string | null
          intake_source_url?: string | null
          organization_id?: string
          platforms?: string[]
          publish_at?: string
          published_at?: string | null
          script_outline?: string
          status?: Database["public"]["Enums"]["content_status"]
          thumbnail_brief?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_revision_requests: {
        Row: {
          assigned_to: string
          content_item_id: string
          id: string
          instructions: string
          organization_id: string
          requested_at: string
          requested_by: string
          resolved_at: string | null
          resolved_by: string | null
          round: number
          stage: Database["public"]["Enums"]["content_step"]
          started_at: string | null
          status: Database["public"]["Enums"]["content_revision_status"]
          task_id: string
        }
        Insert: {
          assigned_to: string
          content_item_id: string
          id?: string
          instructions: string
          organization_id: string
          requested_at?: string
          requested_by: string
          resolved_at?: string | null
          resolved_by?: string | null
          round: number
          stage: Database["public"]["Enums"]["content_step"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["content_revision_status"]
          task_id: string
        }
        Update: {
          assigned_to?: string
          content_item_id?: string
          id?: string
          instructions?: string
          organization_id?: string
          requested_at?: string
          requested_by?: string
          resolved_at?: string | null
          resolved_by?: string | null
          round?: number
          stage?: Database["public"]["Enums"]["content_step"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["content_revision_status"]
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_revision_requests_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_revision_requests_content_org_fkey"
            columns: ["content_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "content_revision_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_revision_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_revision_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_revision_requests_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      content_step_deliveries: {
        Row: {
          content_item_id: string
          id: string
          organization_id: string
          result_note: string | null
          result_url: string | null
          step: Database["public"]["Enums"]["content_step"]
          submitted_at: string
          submitted_by: string
          task_id: string
          updated_at: string
          version: number
        }
        Insert: {
          content_item_id: string
          id?: string
          organization_id: string
          result_note?: string | null
          result_url?: string | null
          step: Database["public"]["Enums"]["content_step"]
          submitted_at?: string
          submitted_by: string
          task_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          content_item_id?: string
          id?: string
          organization_id?: string
          result_note?: string | null
          result_url?: string | null
          step?: Database["public"]["Enums"]["content_step"]
          submitted_at?: string
          submitted_by?: string
          task_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_step_deliveries_content_org_fkey"
            columns: ["content_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "content_step_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_step_deliveries_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_step_deliveries_task_identity_fkey"
            columns: ["task_id", "organization_id", "content_item_id", "step"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: [
              "id",
              "organization_id",
              "content_item_id",
              "content_step",
            ]
          },
        ]
      }
      content_timeline_cues: {
        Row: {
          action: string
          completed_at: string | null
          completed_by: string | null
          content_item_id: string
          created_at: string
          created_by: string
          end_seconds: number | null
          id: string
          kind: Database["public"]["Enums"]["content_cue_kind"]
          organization_id: string
          sort_order: number
          source_url: string | null
          start_seconds: number
        }
        Insert: {
          action: string
          completed_at?: string | null
          completed_by?: string | null
          content_item_id: string
          created_at?: string
          created_by: string
          end_seconds?: number | null
          id?: string
          kind: Database["public"]["Enums"]["content_cue_kind"]
          organization_id: string
          sort_order: number
          source_url?: string | null
          start_seconds: number
        }
        Update: {
          action?: string
          completed_at?: string | null
          completed_by?: string | null
          content_item_id?: string
          created_at?: string
          created_by?: string
          end_seconds?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["content_cue_kind"]
          organization_id?: string
          sort_order?: number
          source_url?: string | null
          start_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_timeline_cues_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_timeline_cues_content_org_fkey"
            columns: ["content_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "content_timeline_cues_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_timeline_cues_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_activities: {
        Row: {
          actor_id: string | null
          contact_id: string
          from_stage: Database["public"]["Enums"]["crm_lead_stage"] | null
          id: number
          kind: Database["public"]["Enums"]["crm_activity_kind"]
          next_follow_up_at: string | null
          occurred_at: string
          organization_id: string
          summary: string
          to_stage: Database["public"]["Enums"]["crm_lead_stage"]
        }
        Insert: {
          actor_id?: string | null
          contact_id: string
          from_stage?: Database["public"]["Enums"]["crm_lead_stage"] | null
          id?: never
          kind: Database["public"]["Enums"]["crm_activity_kind"]
          next_follow_up_at?: string | null
          occurred_at?: string
          organization_id: string
          summary: string
          to_stage: Database["public"]["Enums"]["crm_lead_stage"]
        }
        Update: {
          actor_id?: string | null
          contact_id?: string
          from_stage?: Database["public"]["Enums"]["crm_lead_stage"] | null
          id?: never
          kind?: Database["public"]["Enums"]["crm_activity_kind"]
          next_follow_up_at?: string | null
          occurred_at?: string
          organization_id?: string
          summary?: string
          to_stage?: Database["public"]["Enums"]["crm_lead_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "crm_activities_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_contact_org_fkey"
            columns: ["contact_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "crm_activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contacts: {
        Row: {
          closure_reason: string | null
          consent_status: Database["public"]["Enums"]["crm_consent_status"]
          converted_at: string | null
          created_at: string
          created_by: string
          full_name: string
          id: string
          interest: Database["public"]["Enums"]["crm_interest"]
          interest_detail: string | null
          last_contacted_at: string | null
          next_follow_up_at: string | null
          notes: string | null
          organization_id: string
          owner_id: string
          source: Database["public"]["Enums"]["crm_source"]
          source_detail: string | null
          stage: Database["public"]["Enums"]["crm_lead_stage"]
          updated_at: string
          version: number
        }
        Insert: {
          closure_reason?: string | null
          consent_status?: Database["public"]["Enums"]["crm_consent_status"]
          converted_at?: string | null
          created_at?: string
          created_by: string
          full_name: string
          id?: string
          interest: Database["public"]["Enums"]["crm_interest"]
          interest_detail?: string | null
          last_contacted_at?: string | null
          next_follow_up_at?: string | null
          notes?: string | null
          organization_id: string
          owner_id: string
          source: Database["public"]["Enums"]["crm_source"]
          source_detail?: string | null
          stage?: Database["public"]["Enums"]["crm_lead_stage"]
          updated_at?: string
          version?: number
        }
        Update: {
          closure_reason?: string | null
          consent_status?: Database["public"]["Enums"]["crm_consent_status"]
          converted_at?: string | null
          created_at?: string
          created_by?: string
          full_name?: string
          id?: string
          interest?: Database["public"]["Enums"]["crm_interest"]
          interest_detail?: string | null
          last_contacted_at?: string | null
          next_follow_up_at?: string | null
          notes?: string | null
          organization_id?: string
          owner_id?: string
          source?: Database["public"]["Enums"]["crm_source"]
          source_detail?: string | null
          stage?: Database["public"]["Enums"]["crm_lead_stage"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_conversation_links: {
        Row: {
          channel: Database["public"]["Enums"]["crm_conversation_channel"]
          contact_id: string
          created_at: string
          created_by: string
          id: string
          is_primary: boolean
          label: string | null
          organization_id: string
          url: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["crm_conversation_channel"]
          contact_id: string
          created_at?: string
          created_by: string
          id?: string
          is_primary?: boolean
          label?: string | null
          organization_id: string
          url: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["crm_conversation_channel"]
          contact_id?: string
          created_at?: string
          created_by?: string
          id?: string
          is_primary?: boolean
          label?: string | null
          organization_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_conversation_links_contact_org_fkey"
            columns: ["contact_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "crm_conversation_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_conversation_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_identities: {
        Row: {
          contact_id: string
          created_at: string
          created_by: string
          id: string
          is_primary: boolean
          kind: Database["public"]["Enums"]["crm_identity_kind"]
          normalized_value: string
          organization_id: string
          value: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          created_by: string
          id?: string
          is_primary?: boolean
          kind: Database["public"]["Enums"]["crm_identity_kind"]
          normalized_value: string
          organization_id: string
          value: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          created_by?: string
          id?: string
          is_primary?: boolean
          kind?: Database["public"]["Enums"]["crm_identity_kind"]
          normalized_value?: string
          organization_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_identities_contact_org_fkey"
            columns: ["contact_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "crm_identities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_identities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_content_items: {
        Row: {
          content_item_id: string
          created_at: string
          created_by: string
          deliverable_sequence: number | null
          launch_deliverable_id: string | null
          launch_id: string
          organization_id: string
        }
        Insert: {
          content_item_id: string
          created_at?: string
          created_by?: string
          deliverable_sequence?: number | null
          launch_deliverable_id?: string | null
          launch_id: string
          organization_id: string
        }
        Update: {
          content_item_id?: string
          created_at?: string
          created_by?: string
          deliverable_sequence?: number | null
          launch_deliverable_id?: string | null
          launch_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_content_items_content_item_id_organization_id_fkey"
            columns: ["content_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "launch_content_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_content_items_deliverable_org_fkey"
            columns: ["launch_deliverable_id", "launch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "launch_deliverables"
            referencedColumns: ["id", "launch_id", "organization_id"]
          },
          {
            foreignKeyName: "launch_content_items_launch_id_organization_id_fkey"
            columns: ["launch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      launch_deliverable_dependencies: {
        Row: {
          created_at: string
          created_by: string
          deliverable_id: string
          depends_on_deliverable_id: string
          launch_id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          deliverable_id: string
          depends_on_deliverable_id: string
          launch_id: string
          organization_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          deliverable_id?: string
          depends_on_deliverable_id?: string
          launch_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_deliverable_dependenci_deliverable_id_launch_id_org_fkey"
            columns: ["deliverable_id", "launch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "launch_deliverables"
            referencedColumns: ["id", "launch_id", "organization_id"]
          },
          {
            foreignKeyName: "launch_deliverable_dependenci_depends_on_deliverable_id_la_fkey"
            columns: [
              "depends_on_deliverable_id",
              "launch_id",
              "organization_id",
            ]
            isOneToOne: false
            referencedRelation: "launch_deliverables"
            referencedColumns: ["id", "launch_id", "organization_id"]
          },
          {
            foreignKeyName: "launch_deliverable_dependencies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_deliverables: {
        Row: {
          brief: string
          budget_amount: number
          budget_category: Database["public"]["Enums"]["launch_budget_category"]
          channel: string | null
          created_at: string
          created_by: string
          creation_request_id: string | null
          currency: string
          delivered_at: string | null
          destination: string | null
          due_at: string
          id: string
          kind: Database["public"]["Enums"]["launch_deliverable_kind"]
          launch_id: string
          organization_id: string
          owner_id: string
          planned_quantity: number
          result_note: string | null
          result_url: string | null
          title: string
          workflow_template: string
        }
        Insert: {
          brief: string
          budget_amount?: number
          budget_category?: Database["public"]["Enums"]["launch_budget_category"]
          channel?: string | null
          created_at?: string
          created_by: string
          creation_request_id?: string | null
          currency?: string
          delivered_at?: string | null
          destination?: string | null
          due_at: string
          id?: string
          kind: Database["public"]["Enums"]["launch_deliverable_kind"]
          launch_id: string
          organization_id: string
          owner_id: string
          planned_quantity?: number
          result_note?: string | null
          result_url?: string | null
          title: string
          workflow_template?: string
        }
        Update: {
          brief?: string
          budget_amount?: number
          budget_category?: Database["public"]["Enums"]["launch_budget_category"]
          channel?: string | null
          created_at?: string
          created_by?: string
          creation_request_id?: string | null
          currency?: string
          delivered_at?: string | null
          destination?: string | null
          due_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["launch_deliverable_kind"]
          launch_id?: string
          organization_id?: string
          owner_id?: string
          planned_quantity?: number
          result_note?: string | null
          result_url?: string | null
          title?: string
          workflow_template?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_deliverables_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_deliverables_launch_id_organization_id_fkey"
            columns: ["launch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "launch_deliverables_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_documents: {
        Row: {
          created_at: string
          created_by: string
          document_url: string | null
          gate: Database["public"]["Enums"]["launch_gate"]
          id: string
          launch_id: string
          organization_id: string
          status: Database["public"]["Enums"]["launch_document_status"]
          summary: string
          title: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by: string
          document_url?: string | null
          gate: Database["public"]["Enums"]["launch_gate"]
          id?: string
          launch_id: string
          organization_id: string
          status?: Database["public"]["Enums"]["launch_document_status"]
          summary: string
          title: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string
          document_url?: string | null
          gate?: Database["public"]["Enums"]["launch_gate"]
          id?: string
          launch_id?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["launch_document_status"]
          summary?: string
          title?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "launch_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_documents_launch_id_organization_id_fkey"
            columns: ["launch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      launches: {
        Row: {
          audience: string
          created_at: string
          created_by: string
          currency: string
          ends_at: string
          id: string
          lead_target: number | null
          objective: string
          offer: string
          organization_id: string
          owner_id: string
          primary_cta: string
          revenue_target: number | null
          sales_target: number | null
          starts_at: string
          status: Database["public"]["Enums"]["launch_status"]
          title: string
          type: Database["public"]["Enums"]["launch_type"]
          updated_at: string
          version: number
        }
        Insert: {
          audience: string
          created_at?: string
          created_by?: string
          currency?: string
          ends_at: string
          id?: string
          lead_target?: number | null
          objective: string
          offer: string
          organization_id: string
          owner_id: string
          primary_cta: string
          revenue_target?: number | null
          sales_target?: number | null
          starts_at: string
          status?: Database["public"]["Enums"]["launch_status"]
          title: string
          type: Database["public"]["Enums"]["launch_type"]
          updated_at?: string
          version?: number
        }
        Update: {
          audience?: string
          created_at?: string
          created_by?: string
          currency?: string
          ends_at?: string
          id?: string
          lead_target?: number | null
          objective?: string
          offer?: string
          organization_id?: string
          owner_id?: string
          primary_cta?: string
          revenue_target?: number | null
          sales_target?: number | null
          starts_at?: string
          status?: Database["public"]["Enums"]["launch_status"]
          title?: string
          type?: Database["public"]["Enums"]["launch_type"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "launches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launches_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      member_presence: {
        Row: {
          current_section: string
          last_seen_at: string
          organization_id: string
          session_started_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          current_section: string
          last_seen_at?: string
          organization_id: string
          session_started_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          current_section?: string
          last_seen_at?: string
          organization_id?: string
          session_started_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_presence_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_presence_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          joined_at: string | null
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          dedupe_key: string
          entity_id: string | null
          entity_type: string
          id: number
          kind: string
          organization_id: string
          read_at: string | null
          title: string
          url: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          dedupe_key: string
          entity_id?: string | null
          entity_type: string
          id?: never
          kind: string
          organization_id: string
          read_at?: string | null
          title: string
          url: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          dedupe_key?: string
          entity_id?: string | null
          entity_type?: string
          id?: never
          kind?: string
          organization_id?: string
          read_at?: string | null
          title?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      publishing_admin_connections: {
        Row: {
          connected_at: string | null
          link_code_hash: string | null
          link_expires_at: string | null
          notifications_enabled: boolean
          organization_id: string
          telegram_chat_id: number | null
          telegram_user_id: number | null
          telegram_username: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          connected_at?: string | null
          link_code_hash?: string | null
          link_expires_at?: string | null
          notifications_enabled?: boolean
          organization_id: string
          telegram_chat_id?: number | null
          telegram_user_id?: number | null
          telegram_username?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          connected_at?: string | null
          link_code_hash?: string | null
          link_expires_at?: string | null
          notifications_enabled?: boolean
          organization_id?: string
          telegram_chat_id?: number | null
          telegram_user_id?: number | null
          telegram_username?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publishing_admin_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_admin_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      publishing_channels: {
        Row: {
          allowlisted: boolean
          bot_can_post: boolean
          bot_user_id: number | null
          bot_username: string | null
          created_at: string
          created_by: string
          id: string
          last_error: string | null
          organization_id: string
          platform: string
          telegram_chat_id: number
          telegram_username: string | null
          title: string
          updated_at: string
          verification_status: string
          verified_at: string | null
        }
        Insert: {
          allowlisted?: boolean
          bot_can_post?: boolean
          bot_user_id?: number | null
          bot_username?: string | null
          created_at?: string
          created_by: string
          id?: string
          last_error?: string | null
          organization_id: string
          platform?: string
          telegram_chat_id: number
          telegram_username?: string | null
          title: string
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
        }
        Update: {
          allowlisted?: boolean
          bot_can_post?: boolean
          bot_user_id?: number | null
          bot_username?: string | null
          created_at?: string
          created_by?: string
          id?: string
          last_error?: string | null
          organization_id?: string
          platform?: string
          telegram_chat_id?: number
          telegram_username?: string | null
          title?: string
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "publishing_channels_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_channels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      publishing_controls: {
        Row: {
          generation: number
          kill_switch: boolean
          organization_id: string
          reason: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          generation?: number
          kill_switch?: boolean
          organization_id: string
          reason?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          generation?: number
          kill_switch?: boolean
          organization_id?: string
          reason?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "publishing_controls_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_controls_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      publishing_occurrences: {
        Row: {
          approved_snapshot_hash: string | null
          automation_generation: number | null
          callback_consumed_at: string | null
          callback_token: string
          created_at: string
          error: string | null
          hold_reason: string | null
          id: string
          occurrence_key: string
          organization_id: string
          post_id: string
          preview_chat_id: number | null
          preview_claim_token: string | null
          preview_claimed_at: string | null
          preview_message_id: number | null
          preview_sent_at: string | null
          schedule_id: string
          scheduled_at: string
          snapshot_hash: string | null
          snapshot_payload: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          approved_snapshot_hash?: string | null
          automation_generation?: number | null
          callback_consumed_at?: string | null
          callback_token?: string
          created_at?: string
          error?: string | null
          hold_reason?: string | null
          id?: string
          occurrence_key: string
          organization_id: string
          post_id: string
          preview_chat_id?: number | null
          preview_claim_token?: string | null
          preview_claimed_at?: string | null
          preview_message_id?: number | null
          preview_sent_at?: string | null
          schedule_id: string
          scheduled_at: string
          snapshot_hash?: string | null
          snapshot_payload?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          approved_snapshot_hash?: string | null
          automation_generation?: number | null
          callback_consumed_at?: string | null
          callback_token?: string
          created_at?: string
          error?: string | null
          hold_reason?: string | null
          id?: string
          occurrence_key?: string
          organization_id?: string
          post_id?: string
          preview_chat_id?: number | null
          preview_claim_token?: string | null
          preview_claimed_at?: string | null
          preview_message_id?: number | null
          preview_sent_at?: string | null
          schedule_id?: string
          scheduled_at?: string
          snapshot_hash?: string | null
          snapshot_payload?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "publishing_occurrences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_occurrences_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "publishing_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_occurrences_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "publishing_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      publishing_posts: {
        Row: {
          content_item_id: string | null
          created_at: string
          created_by: string
          disable_link_preview: boolean
          id: string
          link_url: string | null
          media_asset_id: string | null
          media_kind: string
          media_source: string | null
          name: string
          organization_id: string
          post_text: string
          status: string
          updated_at: string
        }
        Insert: {
          content_item_id?: string | null
          created_at?: string
          created_by: string
          disable_link_preview?: boolean
          id?: string
          link_url?: string | null
          media_asset_id?: string | null
          media_kind?: string
          media_source?: string | null
          name: string
          organization_id: string
          post_text?: string
          status?: string
          updated_at?: string
        }
        Update: {
          content_item_id?: string | null
          created_at?: string
          created_by?: string
          disable_link_preview?: boolean
          id?: string
          link_url?: string | null
          media_asset_id?: string | null
          media_kind?: string
          media_source?: string | null
          name?: string
          organization_id?: string
          post_text?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "publishing_posts_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_posts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_posts_media_asset_org_fkey"
            columns: ["organization_id", "media_asset_id"]
            isOneToOne: false
            referencedRelation: "publishing_telegram_assets"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "publishing_posts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      publishing_publication_logs: {
        Row: {
          attempt_count: number
          channel_id: string
          claim_expires_at: string
          claim_generation: number
          claim_token: string
          created_at: string
          error: string | null
          id: string
          message_id: number | null
          message_url: string | null
          network_started_at: string | null
          occurrence_id: string
          organization_id: string
          post_id: string
          published_at: string | null
          status: string
          telegram_error_code: number | null
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          channel_id: string
          claim_expires_at: string
          claim_generation: number
          claim_token: string
          created_at?: string
          error?: string | null
          id?: string
          message_id?: number | null
          message_url?: string | null
          network_started_at?: string | null
          occurrence_id: string
          organization_id: string
          post_id: string
          published_at?: string | null
          status: string
          telegram_error_code?: number | null
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          channel_id?: string
          claim_expires_at?: string
          claim_generation?: number
          claim_token?: string
          created_at?: string
          error?: string | null
          id?: string
          message_id?: number | null
          message_url?: string | null
          network_started_at?: string | null
          occurrence_id?: string
          organization_id?: string
          post_id?: string
          published_at?: string | null
          status?: string
          telegram_error_code?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "publishing_publication_logs_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "publishing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_publication_logs_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "publishing_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_publication_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_publication_logs_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "publishing_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      publishing_schedule_channels: {
        Row: {
          channel_id: string
          created_at: string
          organization_id: string
          schedule_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          organization_id: string
          schedule_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          organization_id?: string
          schedule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publishing_schedule_channels_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "publishing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_schedule_channels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_schedule_channels_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "publishing_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      publishing_schedules: {
        Row: {
          created_at: string
          created_by: string
          deleted_at: string | null
          ends_on: string | null
          id: string
          missed_grace_minutes: number
          occurrence_limit: number | null
          once_at: string | null
          organization_id: string
          paused: boolean
          post_id: string
          preview_lead_minutes: number
          preview_policy: string
          schedule_type: string
          starts_on: string | null
          time_local: string | null
          timezone_name: string
          updated_at: string
          weekdays: number[] | null
        }
        Insert: {
          created_at?: string
          created_by: string
          deleted_at?: string | null
          ends_on?: string | null
          id?: string
          missed_grace_minutes?: number
          occurrence_limit?: number | null
          once_at?: string | null
          organization_id: string
          paused?: boolean
          post_id: string
          preview_lead_minutes?: number
          preview_policy?: string
          schedule_type: string
          starts_on?: string | null
          time_local?: string | null
          timezone_name?: string
          updated_at?: string
          weekdays?: number[] | null
        }
        Update: {
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          ends_on?: string | null
          id?: string
          missed_grace_minutes?: number
          occurrence_limit?: number | null
          once_at?: string | null
          organization_id?: string
          paused?: boolean
          post_id?: string
          preview_lead_minutes?: number
          preview_policy?: string
          schedule_type?: string
          starts_on?: string | null
          time_local?: string | null
          timezone_name?: string
          updated_at?: string
          weekdays?: number[] | null
        }
        Relationships: [
          {
            foreignKeyName: "publishing_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_schedules_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "publishing_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      publishing_telegram_assets: {
        Row: {
          archived_at: string | null
          created_at: string
          display_name: string
          duration_seconds: number | null
          file_name: string | null
          file_size: number | null
          height: number | null
          id: string
          last_received_at: string
          media_kind: string
          mime_type: string | null
          organization_id: string
          original_caption: string | null
          preview_object_path: string | null
          received_by_user_id: string
          telegram_chat_id: number
          telegram_file_id: string
          telegram_file_unique_id: string
          telegram_message_id: number
          telegram_user_id: number
          updated_at: string
          width: number | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          display_name: string
          duration_seconds?: number | null
          file_name?: string | null
          file_size?: number | null
          height?: number | null
          id?: string
          last_received_at?: string
          media_kind: string
          mime_type?: string | null
          organization_id: string
          original_caption?: string | null
          preview_object_path?: string | null
          received_by_user_id: string
          telegram_chat_id: number
          telegram_file_id: string
          telegram_file_unique_id: string
          telegram_message_id: number
          telegram_user_id: number
          updated_at?: string
          width?: number | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          display_name?: string
          duration_seconds?: number | null
          file_name?: string | null
          file_size?: number | null
          height?: number | null
          id?: string
          last_received_at?: string
          media_kind?: string
          mime_type?: string | null
          organization_id?: string
          original_caption?: string | null
          preview_object_path?: string | null
          received_by_user_id?: string
          telegram_chat_id?: number
          telegram_file_id?: string
          telegram_file_unique_id?: string
          telegram_message_id?: number
          telegram_user_id?: number
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "publishing_telegram_assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_telegram_assets_received_by_user_id_fkey"
            columns: ["received_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      script_research_items: {
        Row: {
          assigned_to: string
          brand_fit: number | null
          created_at: string
          created_by: string
          freshness: number | null
          hook: string
          id: string
          kind: Database["public"]["Enums"]["script_research_kind"]
          linked_script_id: string | null
          organization_id: string
          original_angles: string[]
          performance_signal: number | null
          raw_notes: string
          source_url: string | null
          status: Database["public"]["Enums"]["script_research_status"]
          title: string
          transcript: string
          transferable_principle: string
          updated_at: string
          used_at: string | null
          why_it_works: string
        }
        Insert: {
          assigned_to: string
          brand_fit?: number | null
          created_at?: string
          created_by: string
          freshness?: number | null
          hook?: string
          id?: string
          kind?: Database["public"]["Enums"]["script_research_kind"]
          linked_script_id?: string | null
          organization_id: string
          original_angles?: string[]
          performance_signal?: number | null
          raw_notes?: string
          source_url?: string | null
          status?: Database["public"]["Enums"]["script_research_status"]
          title: string
          transcript?: string
          transferable_principle?: string
          updated_at?: string
          used_at?: string | null
          why_it_works?: string
        }
        Update: {
          assigned_to?: string
          brand_fit?: number | null
          created_at?: string
          created_by?: string
          freshness?: number | null
          hook?: string
          id?: string
          kind?: Database["public"]["Enums"]["script_research_kind"]
          linked_script_id?: string | null
          organization_id?: string
          original_angles?: string[]
          performance_signal?: number | null
          raw_notes?: string
          source_url?: string | null
          status?: Database["public"]["Enums"]["script_research_status"]
          title?: string
          transcript?: string
          transferable_principle?: string
          updated_at?: string
          used_at?: string | null
          why_it_works?: string
        }
        Relationships: [
          {
            foreignKeyName: "script_research_items_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_research_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_research_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_research_script_org_fkey"
            columns: ["linked_script_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "scripts"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      script_versions: {
        Row: {
          created_at: string
          created_by: string
          id: string
          note: string | null
          organization_id: string
          script_id: string
          snapshot: Json
          source: Database["public"]["Enums"]["script_version_source"]
          version_number: number
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          note?: string | null
          organization_id: string
          script_id: string
          snapshot: Json
          source: Database["public"]["Enums"]["script_version_source"]
          version_number: number
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          note?: string | null
          organization_id?: string
          script_id?: string
          snapshot?: Json
          source?: Database["public"]["Enums"]["script_version_source"]
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "script_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_versions_script_org_fkey"
            columns: ["script_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "scripts"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      script_voice_profiles: {
        Row: {
          approved_examples: string
          banned_phrases: string[]
          created_at: string
          edit_version: number
          organization_id: string
          source_notes: string
          story_bank: string[]
          updated_at: string
          updated_by: string
          voice_summary: string
          writing_rules: string[]
        }
        Insert: {
          approved_examples?: string
          banned_phrases?: string[]
          created_at?: string
          edit_version?: number
          organization_id: string
          source_notes?: string
          story_bank?: string[]
          updated_at?: string
          updated_by: string
          voice_summary?: string
          writing_rules?: string[]
        }
        Update: {
          approved_examples?: string
          banned_phrases?: string[]
          created_at?: string
          edit_version?: number
          organization_id?: string
          source_notes?: string
          story_bank?: string[]
          updated_at?: string
          updated_by?: string
          voice_summary?: string
          writing_rules?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "script_voice_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_voice_profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scripts: {
        Row: {
          ai_last_generated_at: string | null
          ai_last_generated_by: string | null
          archived_at: string | null
          archived_by: string | null
          assigned_to: string
          audience: string
          b_roll_notes: string
          caption: string
          claims_notes: string
          content_item_id: string | null
          content_pillar: string | null
          created_at: string
          created_by: string
          cta: string
          duration_seconds: number
          edit_version: number
          editing_notes: string
          handed_off_at: string | null
          handed_off_by: string | null
          hashtags: string[]
          hook_variants: string[]
          id: string
          input_mode: Database["public"]["Enums"]["script_input_mode"]
          objective: string
          on_screen_text: string
          organization_id: string
          platform: string
          recording_notes: string
          source_text: string | null
          source_url: string | null
          spoken_script: string
          status: Database["public"]["Enums"]["script_status"]
          thumbnail_notes: string
          title: string
          updated_at: string
        }
        Insert: {
          ai_last_generated_at?: string | null
          ai_last_generated_by?: string | null
          archived_at?: string | null
          archived_by?: string | null
          assigned_to: string
          audience?: string
          b_roll_notes?: string
          caption?: string
          claims_notes?: string
          content_item_id?: string | null
          content_pillar?: string | null
          created_at?: string
          created_by: string
          cta?: string
          duration_seconds?: number
          edit_version?: number
          editing_notes?: string
          handed_off_at?: string | null
          handed_off_by?: string | null
          hashtags?: string[]
          hook_variants?: string[]
          id?: string
          input_mode?: Database["public"]["Enums"]["script_input_mode"]
          objective: string
          on_screen_text?: string
          organization_id: string
          platform?: string
          recording_notes?: string
          source_text?: string | null
          source_url?: string | null
          spoken_script?: string
          status?: Database["public"]["Enums"]["script_status"]
          thumbnail_notes?: string
          title: string
          updated_at?: string
        }
        Update: {
          ai_last_generated_at?: string | null
          ai_last_generated_by?: string | null
          archived_at?: string | null
          archived_by?: string | null
          assigned_to?: string
          audience?: string
          b_roll_notes?: string
          caption?: string
          claims_notes?: string
          content_item_id?: string | null
          content_pillar?: string | null
          created_at?: string
          created_by?: string
          cta?: string
          duration_seconds?: number
          edit_version?: number
          editing_notes?: string
          handed_off_at?: string | null
          handed_off_by?: string | null
          hashtags?: string[]
          hook_variants?: string[]
          id?: string
          input_mode?: Database["public"]["Enums"]["script_input_mode"]
          objective?: string
          on_screen_text?: string
          organization_id?: string
          platform?: string
          recording_notes?: string
          source_text?: string | null
          source_url?: string | null
          spoken_script?: string
          status?: Database["public"]["Enums"]["script_status"]
          thumbnail_notes?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scripts_ai_last_generated_by_fkey"
            columns: ["ai_last_generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scripts_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scripts_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scripts_content_org_fkey"
            columns: ["content_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "scripts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scripts_handed_off_by_fkey"
            columns: ["handed_off_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scripts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          created_at: string
          depends_on_task_id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          depends_on_task_id: string
          task_id: string
        }
        Update: {
          created_at?: string
          depends_on_task_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_events: {
        Row: {
          actor_id: string | null
          details: Json
          event_type: string
          from_status: Database["public"]["Enums"]["task_status"] | null
          id: number
          occurred_at: string
          organization_id: string
          task_id: string
          to_status: Database["public"]["Enums"]["task_status"] | null
        }
        Insert: {
          actor_id?: string | null
          details?: Json
          event_type: string
          from_status?: Database["public"]["Enums"]["task_status"] | null
          id?: never
          occurred_at?: string
          organization_id: string
          task_id: string
          to_status?: Database["public"]["Enums"]["task_status"] | null
        }
        Update: {
          actor_id?: string | null
          details?: Json
          event_type?: string
          from_status?: Database["public"]["Enums"]["task_status"] | null
          id?: never
          occurred_at?: string
          organization_id?: string
          task_id?: string
          to_status?: Database["public"]["Enums"]["task_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "task_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          acceptance_criteria: string
          completed_at: string | null
          content_item_id: string | null
          content_step: Database["public"]["Enums"]["content_step"] | null
          created_at: string
          created_by: string
          crm_contact_id: string | null
          description: string | null
          due_at: string
          id: string
          is_work_item: boolean
          launch_deliverable_id: string | null
          launch_gate: Database["public"]["Enums"]["launch_gate"] | null
          launch_id: string | null
          organization_id: string
          owner_id: string
          priority: Database["public"]["Enums"]["task_priority"]
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          acceptance_criteria: string
          completed_at?: string | null
          content_item_id?: string | null
          content_step?: Database["public"]["Enums"]["content_step"] | null
          created_at?: string
          created_by?: string
          crm_contact_id?: string | null
          description?: string | null
          due_at: string
          id?: string
          is_work_item?: boolean
          launch_deliverable_id?: string | null
          launch_gate?: Database["public"]["Enums"]["launch_gate"] | null
          launch_id?: string | null
          organization_id: string
          owner_id: string
          priority?: Database["public"]["Enums"]["task_priority"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          acceptance_criteria?: string
          completed_at?: string | null
          content_item_id?: string | null
          content_step?: Database["public"]["Enums"]["content_step"] | null
          created_at?: string
          created_by?: string
          crm_contact_id?: string | null
          description?: string | null
          due_at?: string
          id?: string
          is_work_item?: boolean
          launch_deliverable_id?: string | null
          launch_gate?: Database["public"]["Enums"]["launch_gate"] | null
          launch_id?: string | null
          organization_id?: string
          owner_id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "tasks_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_crm_contact_org_fkey"
            columns: ["crm_contact_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "tasks_launch_deliverable_org_fkey"
            columns: ["launch_deliverable_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "launch_deliverables"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "tasks_launch_id_organization_id_fkey"
            columns: ["launch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_content_asset: {
        Args: {
          asset_kind: Database["public"]["Enums"]["content_asset_kind"]
          asset_notes: string
          asset_stage: Database["public"]["Enums"]["content_step"]
          asset_title: string
          asset_url: string
          target_content_item_id: string
          target_user_id: string
        }
        Returns: string
      }
      add_crm_identity: {
        Args: {
          identity_kind: Database["public"]["Enums"]["crm_identity_kind"]
          identity_value: string
          make_primary?: boolean
          target_contact_id: string
          target_user_id: string
        }
        Returns: string
      }
      approve_brand_article: {
        Args: { target_article_id: string; target_user_id: string }
        Returns: boolean
      }
      archive_brand_article: {
        Args: { target_article_id: string; target_user_id: string }
        Returns: boolean
      }
      attach_content_to_launch: {
        Args: {
          target_content_item_id: string
          target_launch_id: string
          target_user_id: string
        }
        Returns: boolean
      }
      bootstrap_market_whales_organization: {
        Args: { target_user_id: string }
        Returns: string
      }
      cancel_publishing_occurrence: {
        Args: { target_occurrence_id: string }
        Returns: boolean
      }
      change_content_revision: {
        Args: {
          target_action: string
          target_revision_id: string
          target_user_id: string
        }
        Returns: boolean
      }
      change_reel_approval_gate: {
        Args: {
          target_action: string
          target_task_id: string
          target_user_id: string
        }
        Returns: boolean
      }
      change_script_status: {
        Args: {
          expected_edit_version: number
          next_status: Database["public"]["Enums"]["script_status"]
          target_script_id: string
          target_user_id: string
        }
        Returns: number
      }
      change_timeline_cue: {
        Args: {
          target_completed: boolean
          target_cue_id: string
          target_user_id: string
        }
        Returns: boolean
      }
      claim_publication_batch: {
        Args: { target_batch_size?: number }
        Returns: {
          channel_id: string
          claim_generation: number
          claim_token: string
          content_item_id: string
          disable_link_preview: boolean
          link_url: string
          log_id: string
          media_kind: string
          media_source: string
          occurrence_id: string
          organization_id: string
          post_created_by: string
          post_id: string
          post_name: string
          post_text: string
          scheduled_at: string
          telegram_chat_id: number
          telegram_username: string
        }[]
      }
      claim_publishing_preview_batch: {
        Args: { target_batch_size?: number }
        Returns: {
          admin_chat_id: number
          callback_token: string
          claim_token: string
          occurrence_id: string
          organization_id: string
          preview_policy: string
          scheduled_at: string
          snapshot_hash: string
          snapshot_payload: Json
        }[]
      }
      complete_publication_failure: {
        Args: {
          target_claim_token: string
          target_error: string
          target_log_id: string
          target_telegram_error_code: number
          target_terminal_status: string
        }
        Returns: boolean
      }
      complete_publication_success: {
        Args: {
          target_claim_token: string
          target_log_id: string
          target_message_id: number
          target_message_url: string
        }
        Returns: boolean
      }
      complete_publishing_admin_link: {
        Args: {
          raw_link_code: string
          target_telegram_chat_id: number
          target_telegram_user_id: number
          target_telegram_username: string
        }
        Returns: {
          organization_id: string
          user_id: string
        }[]
      }
      complete_publishing_preview: {
        Args: {
          target_claim_token: string
          target_error: string
          target_occurrence_id: string
          target_preview_chat_id: number
          target_preview_message_id: number
        }
        Returns: string
      }
      create_brand_article_draft: {
        Args: {
          article_audiences: Database["public"]["Enums"]["brand_audience"][]
          article_category: Database["public"]["Enums"]["brand_category"]
          article_change_note: string
          article_do_list: string[]
          article_dont_list: string[]
          article_examples: string
          article_guidelines: string
          article_reference_urls: string[]
          article_summary: string
          article_title: string
          target_organization_id: string
          target_user_id: string
        }
        Returns: string
      }
      create_crm_lead: {
        Args: {
          contact_consent_status: Database["public"]["Enums"]["crm_consent_status"]
          contact_full_name: string
          contact_interest: Database["public"]["Enums"]["crm_interest"]
          contact_owner_id: string
          contact_source: Database["public"]["Enums"]["crm_source"]
          identity_kind: Database["public"]["Enums"]["crm_identity_kind"]
          identity_value: string
          initial_notes: string
          target_follow_up_at: string
          target_organization_id: string
          target_user_id: string
        }
        Returns: string
      }
      create_crm_lead_v2: {
        Args: {
          contact_consent_status: Database["public"]["Enums"]["crm_consent_status"]
          contact_full_name: string
          contact_interest: Database["public"]["Enums"]["crm_interest"]
          contact_interest_detail: string
          contact_owner_id: string
          contact_source: Database["public"]["Enums"]["crm_source"]
          contact_source_detail: string
          identity_kind: Database["public"]["Enums"]["crm_identity_kind"]
          identity_value: string
          initial_notes: string
          target_conversation_channel: Database["public"]["Enums"]["crm_conversation_channel"]
          target_conversation_label: string
          target_conversation_url: string
          target_follow_up_at: string
          target_organization_id: string
          target_user_id: string
        }
        Returns: string
      }
      create_crm_lead_v3: {
        Args: {
          contact_consent_status: Database["public"]["Enums"]["crm_consent_status"]
          contact_full_name: string
          contact_identities: Json
          contact_interest: Database["public"]["Enums"]["crm_interest"]
          contact_interest_detail: string
          contact_owner_id: string
          contact_source: Database["public"]["Enums"]["crm_source"]
          contact_source_detail: string
          initial_notes: string
          target_conversation_channel: Database["public"]["Enums"]["crm_conversation_channel"]
          target_conversation_label: string
          target_conversation_url: string
          target_follow_up_at: string
          target_organization_id: string
          target_user_id: string
        }
        Returns: string
      }
      create_launch_deliverable: {
        Args: {
          deliverable_brief: string
          deliverable_budget_amount: number
          deliverable_budget_category: Database["public"]["Enums"]["launch_budget_category"]
          deliverable_channel: string
          deliverable_currency: string
          deliverable_destination: string
          deliverable_due_at: string
          deliverable_kind: Database["public"]["Enums"]["launch_deliverable_kind"]
          deliverable_owner_id: string
          deliverable_quantity: number
          deliverable_title: string
          depends_on_deliverable_id: string
          target_launch_id: string
          target_user_id: string
        }
        Returns: string
      }
      create_launch_workflow: {
        Args: {
          delivery_owner_id: string
          go_no_go_owner_id: string
          launch_audience: string
          launch_cta: string
          launch_currency: string
          launch_day_owner_id: string
          launch_ends_at: string
          launch_kind: Database["public"]["Enums"]["launch_type"]
          launch_lead_target: number
          launch_objective: string
          launch_offer: string
          launch_revenue_target: number
          launch_sales_target: number
          launch_starts_at: string
          launch_title: string
          offer_owner_id: string
          promotion_owner_id: string
          registration_owner_id: string
          strategy_owner_id: string
          target_organization_id: string
          target_user_id: string
          tracking_owner_id: string
        }
        Returns: string
      }
      create_publishing_admin_link: {
        Args: { target_organization_id: string }
        Returns: string
      }
      create_reel_from_intake: {
        Args: {
          approval_owner_id: string
          brief_owner_id: string
          caption_owner_id: string
          content_brand_notes: string
          content_cta: string
          content_editing_brief: string
          content_goal: string
          content_hook: string
          content_script_outline: string
          content_thumbnail_brief: string
          content_title: string
          editing_owner_id: string
          intake_request_text: string
          parsed_assets: Json
          parsed_timeline: Json
          publishing_owner_id: string
          recording_owner_id: string
          target_organization_id: string
          target_publish_at: string
          target_user_id: string
          telegram_source_url: string
          thumbnail_owner_id: string
        }
        Returns: string
      }
      create_reel_from_intake_v2: {
        Args: {
          approval_owner_id: string
          brief_owner_id: string
          caption_owner_id: string
          content_brand_notes: string
          content_cta: string
          content_editing_brief: string
          content_goal: string
          content_hook: string
          content_script_outline: string
          content_thumbnail_brief: string
          content_title: string
          editing_owner_id: string
          intake_request_text: string
          parsed_assets: Json
          parsed_timeline: Json
          publishing_owner_id: string
          recording_owner_id: string
          target_brand_article_ids: string[]
          target_organization_id: string
          target_publish_at: string
          target_user_id: string
          telegram_source_url: string
          thumbnail_owner_id: string
        }
        Returns: string
      }
      create_reel_from_intake_v3: {
        Args: {
          approval_owner_id: string
          content_brand_notes: string
          content_creator_id: string
          content_cta: string
          content_editing_brief: string
          content_goal: string
          content_hook: string
          content_script_outline: string
          content_thumbnail_brief: string
          content_title: string
          editing_owner_id: string
          intake_request_text: string
          parsed_assets: Json
          parsed_timeline: Json
          publishing_owner_id: string
          target_brand_article_ids: string[]
          target_organization_id: string
          target_publish_at: string
          target_user_id: string
          telegram_source_url: string
          thumbnail_owner_id: string
        }
        Returns: string
      }
      create_reel_production_workflow: {
        Args: {
          approval_owner_id: string
          brief_owner_id: string
          caption_owner_id: string
          content_brand_notes: string
          content_cta: string
          content_editing_brief: string
          content_goal: string
          content_hook: string
          content_script_outline: string
          content_thumbnail_brief: string
          content_title: string
          editing_owner_id: string
          initial_raw_url: string
          initial_reference_url: string
          initial_source_url: string
          publishing_owner_id: string
          recording_owner_id: string
          target_organization_id: string
          target_publish_at: string
          target_user_id: string
          thumbnail_owner_id: string
        }
        Returns: string
      }
      create_reel_production_workflow_v2: {
        Args: {
          approval_owner_id: string
          brief_owner_id: string
          caption_owner_id: string
          content_brand_notes: string
          content_cta: string
          content_editing_brief: string
          content_goal: string
          content_hook: string
          content_script_outline: string
          content_thumbnail_brief: string
          content_title: string
          editing_owner_id: string
          initial_raw_url: string
          initial_reference_url: string
          initial_source_url: string
          publishing_owner_id: string
          recording_owner_id: string
          target_brand_article_ids: string[]
          target_organization_id: string
          target_publish_at: string
          target_user_id: string
          thumbnail_owner_id: string
        }
        Returns: string
      }
      create_reel_production_workflow_v3: {
        Args: {
          approval_owner_id: string
          content_brand_notes: string
          content_creator_id: string
          content_cta: string
          content_editing_brief: string
          content_goal: string
          content_hook: string
          content_script_outline: string
          content_thumbnail_brief: string
          content_title: string
          editing_owner_id: string
          initial_raw_url: string
          initial_reference_url: string
          initial_source_url: string
          publishing_owner_id: string
          target_brand_article_ids: string[]
          target_organization_id: string
          target_publish_at: string
          target_user_id: string
          thumbnail_owner_id: string
        }
        Returns: string
      }
      create_reel_workflow: {
        Args: {
          approval_owner_id: string
          brief_owner_id: string
          caption_owner_id: string
          content_cta: string
          content_goal: string
          content_hook: string
          content_title: string
          editing_owner_id: string
          publishing_owner_id: string
          recording_owner_id: string
          target_organization_id: string
          target_publish_at: string
          target_user_id: string
          thumbnail_owner_id: string
        }
        Returns: string
      }
      create_reel_workflow_internal: {
        Args: {
          approval_owner_id: string
          brief_owner_id: string
          caption_owner_id: string
          content_cta: string
          content_goal: string
          content_hook: string
          content_title: string
          editing_owner_id: string
          publishing_owner_id: string
          recording_owner_id: string
          target_organization_id: string
          target_publish_at: string
          thumbnail_owner_id: string
        }
        Returns: string
      }
      create_script_draft: {
        Args: {
          script_audience: string
          script_content_pillar: string
          script_duration_seconds: number
          script_input_mode: Database["public"]["Enums"]["script_input_mode"]
          script_objective: string
          script_platform: string
          script_source_text: string
          script_source_url: string
          script_title: string
          target_assigned_to: string
          target_organization_id: string
          target_user_id: string
        }
        Returns: string
      }
      create_script_from_research: {
        Args: { target_research_id: string; target_user_id: string }
        Returns: string
      }
      create_script_research_item: {
        Args: {
          research_brand_fit: number
          research_freshness: number
          research_hook: string
          research_kind: Database["public"]["Enums"]["script_research_kind"]
          research_original_angles: string[]
          research_performance_signal: number
          research_raw_notes: string
          research_source_url: string
          research_title: string
          research_transcript: string
          research_transferable_principle: string
          research_why_it_works: string
          target_assigned_to: string
          target_organization_id: string
          target_user_id: string
        }
        Returns: string
      }
      create_social_post_deliverable: {
        Args: {
          approval_owner_id: string
          brief_owner_id: string
          caption_owner_id: string
          content_copy_brief: string
          content_cta: string
          content_design_brief: string
          content_goal: string
          content_hook: string
          content_platforms: string[]
          deliverable_brief: string
          deliverable_budget_amount: number
          deliverable_budget_category: Database["public"]["Enums"]["launch_budget_category"]
          deliverable_currency: string
          deliverable_destination: string
          deliverable_due_at: string
          deliverable_owner_id: string
          deliverable_quantity: number
          deliverable_title: string
          depends_on_deliverable_id: string
          design_owner_id: string
          first_publish_at: string
          publishing_owner_id: string
          scheduling_owner_id: string
          target_creation_request_id: string
          target_launch_id: string
          target_user_id: string
        }
        Returns: string
      }
      create_telegram_publication: {
        Args: {
          post_disable_link_preview: boolean
          post_link_url: string
          post_media_kind: string
          post_media_source: string
          post_name: string
          post_text: string
          target_channel_ids: string[]
          target_content_item_id: string
          target_ends_on: string
          target_missed_grace_minutes: number
          target_occurrence_limit: number
          target_once_at: string
          target_organization_id: string
          target_preview_lead_minutes: number
          target_preview_policy: string
          target_schedule_type: string
          target_starts_on: string
          target_time_local: string
          target_weekdays: number[]
        }
        Returns: string
      }
      delete_publishing_schedule: {
        Args: { target_schedule_id: string }
        Returns: boolean
      }
      detach_content_from_launch: {
        Args: {
          target_content_item_id: string
          target_launch_id: string
          target_user_id: string
        }
        Returns: boolean
      }
      get_crm_owner_performance: {
        Args: { target_organization_id: string; target_range_days: number }
        Returns: {
          active_contacts: number
          activities_in_period: number
          completed_follow_ups: number
          last_activity_at: string
          lost_contacts: number
          new_contacts: number
          on_time_follow_ups: number
          overdue_contacts: number
          owner_id: string
          total_contacts: number
          won_contacts: number
          won_in_period: number
        }[]
      }
      get_script_ai_context: {
        Args: { target_script_id: string; target_user_id: string }
        Returns: Json
      }
      get_team_task_performance: {
        Args: {
          range_ends_at: string
          range_starts_at: string
          target_organization_id: string
        }
        Returns: {
          completed_late: number
          completed_on_time: number
          last_activity_at: string
          overdue_open: number
          review_submissions: number
          revisions_received: number
          revisions_requested: number
          tasks_assigned: number
          tasks_completed: number
          tasks_requested: number
          user_id: string
        }[]
      }
      handle_publishing_callback: {
        Args: {
          target_action: string
          target_callback_token: string
          target_telegram_user_id: number
        }
        Returns: {
          occurrence_id: string
          occurrence_scheduled_at: string
          occurrence_status: string
          organization_id: string
        }[]
      }
      handoff_script_to_content: {
        Args: {
          content_creator_id: string
          editing_owner_id: string
          expected_edit_version: number
          publishing_owner_id: string
          target_publish_at: string
          target_script_id: string
          target_user_id: string
          thumbnail_owner_id: string
        }
        Returns: string
      }
      mark_all_notifications_read: {
        Args: { target_organization_id: string }
        Returns: number
      }
      mark_notification_read: {
        Args: { target_notification_id: number }
        Returns: boolean
      }
      mark_publication_network_started: {
        Args: {
          target_claim_generation: number
          target_claim_token: string
          target_log_id: string
        }
        Returns: boolean
      }
      record_crm_activity: {
        Args: {
          activity_kind: Database["public"]["Enums"]["crm_activity_kind"]
          activity_summary: string
          next_stage: Database["public"]["Enums"]["crm_lead_stage"]
          target_contact_id: string
          target_next_follow_up_at: string
          target_user_id: string
        }
        Returns: boolean
      }
      record_member_presence: {
        Args: { target_organization_id: string; target_section: string }
        Returns: boolean
      }
      remove_content_asset: {
        Args: { target_asset_id: string; target_user_id: string }
        Returns: boolean
      }
      request_content_revision: {
        Args: {
          revision_instructions: string
          target_content_item_id: string
          target_stage: Database["public"]["Enums"]["content_step"]
          target_user_id: string
        }
        Returns: string
      }
      revise_brand_article: {
        Args: {
          revision_change_note: string
          target_article_id: string
          target_user_id: string
        }
        Returns: string
      }
      revise_telegram_publication: {
        Args: {
          post_disable_link_preview: boolean
          post_link_url: string
          post_media_kind: string
          post_media_source: string
          post_name: string
          post_text: string
          target_channel_ids: string[]
          target_content_item_id: string
          target_ends_on: string
          target_missed_grace_minutes: number
          target_occurrence_limit: number
          target_once_at: string
          target_preview_lead_minutes: number
          target_preview_policy: string
          target_schedule_id: string
          target_schedule_type: string
          target_starts_on: string
          target_time_local: string
          target_weekdays: number[]
        }
        Returns: string
      }
      save_ai_script_generation: {
        Args: {
          expected_edit_version: number
          script_b_roll_notes: string
          script_caption: string
          script_claims_notes: string
          script_cta: string
          script_editing_notes: string
          script_hashtags: string[]
          script_hook_variants: string[]
          script_on_screen_text: string
          script_recording_notes: string
          script_spoken_script: string
          script_thumbnail_notes: string
          target_script_id: string
          target_user_id: string
        }
        Returns: number
      }
      save_launch_gate_document: {
        Args: {
          document_gate: Database["public"]["Enums"]["launch_gate"]
          document_status: Database["public"]["Enums"]["launch_document_status"]
          document_summary: string
          document_title: string
          target_document_url: string
          target_launch_id: string
          target_user_id: string
        }
        Returns: string
      }
      save_script_draft: {
        Args: {
          expected_edit_version: number
          script_audience: string
          script_b_roll_notes: string
          script_caption: string
          script_claims_notes: string
          script_content_pillar: string
          script_cta: string
          script_duration_seconds: number
          script_editing_notes: string
          script_hashtags: string[]
          script_hook_variants: string[]
          script_input_mode: Database["public"]["Enums"]["script_input_mode"]
          script_objective: string
          script_on_screen_text: string
          script_platform: string
          script_recording_notes: string
          script_source_text: string
          script_source_url: string
          script_spoken_script: string
          script_thumbnail_notes: string
          script_title: string
          target_script_id: string
          target_user_id: string
          version_note: string
        }
        Returns: number
      }
      save_script_voice_profile: {
        Args: {
          expected_edit_version: number
          profile_approved_examples: string
          profile_banned_phrases: string[]
          profile_source_notes: string
          profile_story_bank: string[]
          profile_voice_summary: string
          profile_writing_rules: string[]
          target_organization_id: string
          target_user_id: string
        }
        Returns: number
      }
      search_crm_contacts: {
        Args: {
          result_limit: number
          result_offset: number
          search_query: string
          target_organization_id: string
          target_owner_id: string
          target_scope: string
          target_stage: Database["public"]["Enums"]["crm_lead_stage"]
        }
        Returns: {
          contact_id: string
          total_count: number
        }[]
      }
      set_publishing_kill_switch: {
        Args: {
          target_enabled: boolean
          target_organization_id: string
          target_reason: string
        }
        Returns: number
      }
      set_publishing_schedule_paused: {
        Args: { target_paused: boolean; target_schedule_id: string }
        Returns: boolean
      }
      submit_content_step_delivery: {
        Args: {
          delivery_result_note: string
          delivery_result_url: string
          target_task_id: string
          target_user_id: string
        }
        Returns: string
      }
      submit_launch_deliverable: {
        Args: {
          deliverable_result_note: string
          deliverable_result_url: string
          target_deliverable_id: string
          target_user_id: string
        }
        Returns: boolean
      }
      update_brand_article_draft: {
        Args: {
          article_audiences: Database["public"]["Enums"]["brand_audience"][]
          article_category: Database["public"]["Enums"]["brand_category"]
          article_change_note: string
          article_do_list: string[]
          article_dont_list: string[]
          article_examples: string
          article_guidelines: string
          article_reference_urls: string[]
          article_summary: string
          article_title: string
          expected_edit_version: number
          target_article_id: string
          target_user_id: string
        }
        Returns: boolean
      }
      update_content_production_brief: {
        Args: {
          content_brand_notes: string
          content_editing_brief: string
          content_script_outline: string
          content_thumbnail_brief: string
          target_content_item_id: string
          target_user_id: string
        }
        Returns: boolean
      }
      update_social_post_brief: {
        Args: {
          content_copy_brief: string
          content_cta: string
          content_design_brief: string
          content_goal: string
          content_hook: string
          content_title: string
          target_content_item_id: string
          target_user_id: string
        }
        Returns: boolean
      }
      upsert_verified_publishing_channel: {
        Args: {
          target_chat_id: number
          target_organization_id: string
          target_title: string
          target_user_id: string
          target_username: string
          verification_error: string
          verified_bot_user_id: number
          verified_bot_username: string
          verified_can_post: boolean
        }
        Returns: string
      }
    }
    Enums: {
      ai_api_protocol: "openai_chat_completions" | "openai_responses"
      app_role: "owner" | "admin" | "manager" | "member" | "viewer"
      brand_article_status: "draft" | "approved" | "archived"
      brand_audience:
        | "all"
        | "management"
        | "design"
        | "editing"
        | "copy"
        | "publishing"
        | "sales"
      brand_category:
        | "foundation"
        | "visual_identity"
        | "editing"
        | "copy_voice"
        | "publishing"
        | "compliance"
        | "offer_product"
        | "workflow"
      content_asset_kind:
        | "raw_video"
        | "source"
        | "b_roll"
        | "image"
        | "audio"
        | "reference"
        | "draft_video"
        | "thumbnail"
        | "caption"
        | "final_export"
      content_cue_kind: "cut" | "visual" | "text" | "audio" | "review" | "note"
      content_format:
        | "reel"
        | "carousel"
        | "post"
        | "story"
        | "long_video"
        | "live"
        | "email"
      content_revision_status:
        | "requested"
        | "in_progress"
        | "resolved"
        | "cancelled"
      content_status:
        | "planned"
        | "production"
        | "review"
        | "scheduled"
        | "published"
        | "cancelled"
      content_step:
        | "brief"
        | "recording"
        | "editing"
        | "thumbnail"
        | "caption"
        | "design"
        | "approval"
        | "scheduling"
        | "publishing"
      crm_activity_kind: "created" | "call" | "message" | "email" | "note"
      crm_consent_status: "unknown" | "granted" | "denied"
      crm_conversation_channel:
        | "telegram"
        | "whatsapp"
        | "instagram"
        | "facebook"
        | "messenger"
        | "other"
      crm_identity_kind: "phone" | "email" | "telegram"
      crm_interest:
        | "indicator"
        | "signals_gold"
        | "signals_fx"
        | "course"
        | "brokerage"
        | "book"
        | "service"
        | "other"
      crm_lead_stage:
        | "new"
        | "contacted"
        | "qualified"
        | "follow_up"
        | "won"
        | "lost"
        | "do_not_contact"
      crm_source:
        | "manual"
        | "whales_zone"
        | "samihagwa_site"
        | "telegram"
        | "meta"
        | "market_whales_app"
        | "exness"
        | "tickmill"
        | "referral"
        | "other"
      launch_budget_category:
        | "production"
        | "media_spend"
        | "tools"
        | "event"
        | "other"
      launch_deliverable_kind:
        | "reel"
        | "story"
        | "design"
        | "telegram_post"
        | "social_post"
        | "email"
        | "ad"
        | "landing_page"
        | "webinar_asset"
        | "other"
      launch_document_status: "draft" | "submitted" | "approved"
      launch_gate:
        | "strategy"
        | "offer"
        | "registration"
        | "delivery"
        | "promotion"
        | "tracking"
        | "go_no_go"
        | "launch_day"
      launch_status:
        | "planning"
        | "production"
        | "review"
        | "ready"
        | "live"
        | "completed"
        | "cancelled"
      launch_type: "webinar" | "course" | "service" | "book" | "indicator"
      membership_status: "invited" | "active" | "suspended"
      script_input_mode: "idea" | "reference" | "manual"
      script_research_kind: "idea" | "reference" | "competitor"
      script_research_status: "inbox" | "selected" | "used" | "archived"
      script_status: "draft" | "ready_to_record" | "handed_off" | "archived"
      script_version_source: "manual_save" | "ai_generation" | "handoff"
      task_priority: "low" | "normal" | "high" | "urgent"
      task_status:
        | "backlog"
        | "ready"
        | "in_progress"
        | "review"
        | "blocked"
        | "done"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ai_api_protocol: ["openai_chat_completions", "openai_responses"],
      app_role: ["owner", "admin", "manager", "member", "viewer"],
      brand_article_status: ["draft", "approved", "archived"],
      brand_audience: [
        "all",
        "management",
        "design",
        "editing",
        "copy",
        "publishing",
        "sales",
      ],
      brand_category: [
        "foundation",
        "visual_identity",
        "editing",
        "copy_voice",
        "publishing",
        "compliance",
        "offer_product",
        "workflow",
      ],
      content_asset_kind: [
        "raw_video",
        "source",
        "b_roll",
        "image",
        "audio",
        "reference",
        "draft_video",
        "thumbnail",
        "caption",
        "final_export",
      ],
      content_cue_kind: ["cut", "visual", "text", "audio", "review", "note"],
      content_format: [
        "reel",
        "carousel",
        "post",
        "story",
        "long_video",
        "live",
        "email",
      ],
      content_revision_status: [
        "requested",
        "in_progress",
        "resolved",
        "cancelled",
      ],
      content_status: [
        "planned",
        "production",
        "review",
        "scheduled",
        "published",
        "cancelled",
      ],
      content_step: [
        "brief",
        "recording",
        "editing",
        "thumbnail",
        "caption",
        "design",
        "approval",
        "scheduling",
        "publishing",
      ],
      crm_activity_kind: ["created", "call", "message", "email", "note"],
      crm_consent_status: ["unknown", "granted", "denied"],
      crm_conversation_channel: [
        "telegram",
        "whatsapp",
        "instagram",
        "facebook",
        "messenger",
        "other",
      ],
      crm_identity_kind: ["phone", "email", "telegram"],
      crm_interest: [
        "indicator",
        "signals_gold",
        "signals_fx",
        "course",
        "brokerage",
        "book",
        "service",
        "other",
      ],
      crm_lead_stage: [
        "new",
        "contacted",
        "qualified",
        "follow_up",
        "won",
        "lost",
        "do_not_contact",
      ],
      crm_source: [
        "manual",
        "whales_zone",
        "samihagwa_site",
        "telegram",
        "meta",
        "market_whales_app",
        "exness",
        "tickmill",
        "referral",
        "other",
      ],
      launch_budget_category: [
        "production",
        "media_spend",
        "tools",
        "event",
        "other",
      ],
      launch_deliverable_kind: [
        "reel",
        "story",
        "design",
        "telegram_post",
        "social_post",
        "email",
        "ad",
        "landing_page",
        "webinar_asset",
        "other",
      ],
      launch_document_status: ["draft", "submitted", "approved"],
      launch_gate: [
        "strategy",
        "offer",
        "registration",
        "delivery",
        "promotion",
        "tracking",
        "go_no_go",
        "launch_day",
      ],
      launch_status: [
        "planning",
        "production",
        "review",
        "ready",
        "live",
        "completed",
        "cancelled",
      ],
      launch_type: ["webinar", "course", "service", "book", "indicator"],
      membership_status: ["invited", "active", "suspended"],
      script_input_mode: ["idea", "reference", "manual"],
      script_research_kind: ["idea", "reference", "competitor"],
      script_research_status: ["inbox", "selected", "used", "archived"],
      script_status: ["draft", "ready_to_record", "handed_off", "archived"],
      script_version_source: ["manual_save", "ai_generation", "handoff"],
      task_priority: ["low", "normal", "high", "urgent"],
      task_status: [
        "backlog",
        "ready",
        "in_progress",
        "review",
        "blocked",
        "done",
        "cancelled",
      ],
    },
  },
} as const
